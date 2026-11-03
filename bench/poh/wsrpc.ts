// Minimal Effect-RPC-over-WebSocket client speaking the same JSON wire format the web and mobile
// clients use (RpcSerialization.layerJson). It counts every inbound/outbound byte per request.
import { ORCHESTRATION_PROTOCOL_VERSION } from "./protocol.ts";

export interface RpcCounters {
  frames: number;
  bytes: number;
}

interface Pending {
  readonly onChunk?: (values: unknown[], bytes: number) => boolean | void;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  bytes: number;
  frames: number;
}

export class WsRpc {
  readonly socket: WebSocket;
  readonly inbound: RpcCounters = { frames: 0, bytes: 0 };
  readonly outbound: RpcCounters = { frames: 0, bytes: 0 };
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly opened: Promise<void>;
  private closedError: Error | undefined;

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("websocket error")), {
        once: true,
      });
    });
    this.socket.addEventListener("message", (event) => this.onMessage(event.data));
    this.socket.addEventListener("close", (event) => {
      this.closedError = new Error(`websocket closed (${event.code} ${event.reason})`);
      for (const pending of this.pending.values()) pending.reject(this.closedError);
      this.pending.clear();
    });
  }

  static async connect(origin: string, ticket: string): Promise<WsRpc> {
    const url = `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket)}`;
    const client = new WsRpc(url);
    await client.opened;
    return client;
  }

  private send(message: unknown) {
    const text = JSON.stringify(message);
    this.outbound.frames += 1;
    this.outbound.bytes += Buffer.byteLength(text);
    this.socket.send(text);
  }

  private onMessage(data: unknown) {
    const text =
      typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8");
    const bytes = Buffer.byteLength(text);
    this.inbound.frames += 1;
    this.inbound.bytes += bytes;
    // The JSON serializer may batch several messages into one frame as an array.
    const parsed = JSON.parse(text) as unknown;
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages as Array<Record<string, unknown>>) {
      const tag = message._tag;
      if (tag === "Ping") {
        this.send({ _tag: "Pong" });
        continue;
      }
      if (tag === "Pong") continue;
      const requestId = String(message.requestId);
      const pending = this.pending.get(requestId);
      if (!pending) continue;
      pending.bytes += bytes / messages.length;
      pending.frames += 1;
      if (tag === "Chunk") {
        const done = pending.onChunk?.(message.values as unknown[], bytes / messages.length);
        this.send({ _tag: "Ack", requestId });
        if (done === true) {
          this.send({ _tag: "Interrupt", requestId });
          this.pending.delete(requestId);
          pending.resolve(undefined);
        }
      } else if (tag === "Exit") {
        this.pending.delete(requestId);
        const exit = message.exit as { _tag: string; value?: unknown; cause?: unknown };
        if (exit._tag === "Success") pending.resolve(exit.value);
        else pending.reject(new Error(`rpc failed: ${JSON.stringify(exit.cause).slice(0, 2000)}`));
      } else if (tag === "Defect") {
        this.pending.delete(requestId);
        pending.reject(new Error(`rpc defect: ${JSON.stringify(message).slice(0, 2000)}`));
      }
    }
  }

  /** Unary call. */
  call<T>(tag: string, payload: unknown): Promise<{ value: T; bytes: number }> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        resolve: (value) => resolve({ value: value as T, bytes: pending.bytes }),
        reject,
        bytes: 0,
        frames: 0,
      };
      this.pending.set(id, pending);
      this.send({ _tag: "Request", id, tag, payload, headers: [] });
    });
  }

  /**
   * Stream call. `onChunk` sees each chunk's values; returning true ends the subscription (the
   * client interrupts it, as an unmounting view does).
   */
  stream(
    tag: string,
    payload: unknown,
    onChunk: (values: unknown[], bytes: number) => boolean | void,
  ): { done: Promise<{ bytes: number; frames: number }>; id: string } {
    const id = String(this.nextId++);
    const done = new Promise<{ bytes: number; frames: number }>((resolve, reject) => {
      if (this.closedError) return reject(this.closedError);
      const pending: Pending = {
        onChunk,
        resolve: () => resolve({ bytes: pending.bytes, frames: pending.frames }),
        reject,
        bytes: 0,
        frames: 0,
      };
      this.pending.set(id, pending);
      this.send({ _tag: "Request", id, tag, payload, headers: [] });
    });
    return { done, id };
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      this.socket.close();
    });
  }
}
