import * as NodeModule from "node:module";
import * as NodeVM from "node:vm";
import { assert, describe, it } from "@effect/vitest";

import { PI_T3_MCP_EXTENSION_SOURCE } from "./piT3McpExtensionSource.ts";

type RequestHook = (
  event: { payload: unknown },
  ctx: { model: { provider: string } },
) => Record<string, unknown> | undefined;

async function loadRequestHook(): Promise<RequestHook> {
  const handlers = new Map<string, RequestHook>();
  // Execute the shipped extension with MCP disabled; this path needs no Typebox.
  const source = NodeModule.stripTypeScriptTypes(
    PI_T3_MCP_EXTENSION_SOURCE.replace('import { Type } from "typebox";', "").replace(
      "export default async function",
      "async function",
    ),
  );
  await NodeVM.runInNewContext(`${source}\nt3McpExtension(pi)`, {
    process: { env: {} },
    pi: { on: (name: string, handler: RequestHook) => handlers.set(name, handler) },
  });
  const hook = handlers.get("before_provider_request");
  assert.isDefined(hook);
  return hook!;
}

describe("Pi upstream output-budget workaround", () => {
  it.each(["max_tokens", "max_completion_tokens"])(
    "caps %s without changing the conversation or tools",
    async (key) => {
      const hook = await loadRequestHook();
      const payload = {
        model: "moonshotai/kimi-k2.6",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "read" } }],
        [key]: 231_969,
      };
      const result = hook({ payload }, { model: { provider: "openrouter" } });
      assert.equal(result?.[key], 32_768);
      assert.strictEqual(result?.messages, payload.messages);
      assert.strictEqual(result?.tools, payload.tools);
      assert.equal(result?.model, payload.model);
      assert.equal(payload[key], 231_969);
    },
  );

  it("preserves smaller budgets and other providers' payloads", async () => {
    const hook = await loadRequestHook();
    for (const payload of [{ max_tokens: 8192 }, { max_completion_tokens: 32_768 }, {}, null]) {
      assert.isUndefined(hook({ payload }, { model: { provider: "openrouter" } }));
    }
    assert.isUndefined(
      hook({ payload: { max_tokens: 231_969 } }, { model: { provider: "anthropic" } }),
    );
  });
});


describe("Cua stdio restart single flight", () => {
  it("reconnects two simultaneous Pi tool calls with one child and one handshake", async () => {
    const children: Array<{ emitExit: () => void }> = [];
    let initializations = 0;

    // Isolate the actual emitted Pi stdio client, replacing only child_process
    // with a deterministic in-memory pipe. The await preserves the start race.
    const beginning = PI_T3_MCP_EXTENSION_SOURCE.indexOf("function createStdioMcpClient(");
    const end = PI_T3_MCP_EXTENSION_SOURCE.indexOf("\nfunction cuaSpec(", beginning);
    assert.isAtLeast(beginning, 0);
    assert.isAbove(end, beginning);
    const clientSource = PI_T3_MCP_EXTENSION_SOURCE.slice(beginning, end);
    const spawnStatement = 'const { spawn } = await import("node:child_process");';
    assert.include(clientSource, spawnStatement);

    const spawn = () => {
      const stdoutListeners: Array<(chunk: string) => void> = [];
      const exitListeners: Array<() => void> = [];
      const child = {
        stdout: {
          setEncoding: (_encoding: string) => undefined,
          on: (event: string, callback: (chunk: string) => void) => {
            if (event === "data") stdoutListeners.push(callback);
          },
        },
        stdin: {
          write: (line: string) => {
            const request = JSON.parse(line) as {
              readonly id?: number;
              readonly method: string;
              readonly params?: { readonly name?: string };
            };
            if (request.method === "initialize") initializations += 1;
            if (request.id === undefined) return;
            const result =
              request.method === "tools/call"
                ? { content: [{ type: "text", text: request.params?.name ?? "" }] }
                : {};
            queueMicrotask(() => {
              const reply = JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n";
              for (const listener of stdoutListeners) listener(reply);
            });
          },
        },
        on: (event: string, callback: () => void) => {
          if (event === "exit") exitListeners.push(callback);
        },
        kill: () => {
          for (const callback of exitListeners) callback();
        },
        emitExit: () => {
          for (const callback of exitListeners) callback();
        },
      };
      children.push(child);
      return child;
    };

    const source = NodeModule.stripTypeScriptTypes(
      clientSource.replace(
        spawnStatement,
        "const { spawn } = await Promise.resolve(__fakeChildProcess);",
      ),
    );
    const makeClient = NodeVM.runInNewContext(source + "\ncreateStdioMcpClient", {
      __fakeChildProcess: { spawn },
      process: { env: {} },
      PROTOCOL: "2025-06-18",
      AbortSignal,
      Promise,
    }) as (spec: { command: string; args: string[]; env: Record<string, string> }) => {
      connect(): Promise<void>;
      callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
      close(): void;
    };

    const client = makeClient({ command: "fake-driver", args: [], env: {} });
    await client.connect();
    assert.equal(children.length, 1);
    assert.equal(initializations, 1);

    children[0]!.emitExit();
    const [one, two] = await Promise.all([
      client.callTool("list_apps", {}, AbortSignal.timeout(1_000)),
      client.callTool("get_window_state", {}, AbortSignal.timeout(1_000)),
    ]);
    assert.equal(children.length, 2, "concurrent reconnect must not spawn two children");
    assert.equal(initializations, 2, "reconnect must initialize exactly once");
    assert.equal(
      (one as { content: Array<{ text: string }> }).content[0]?.text,
      "list_apps",
    );
    assert.equal(
      (two as { content: Array<{ text: string }> }).content[0]?.text,
      "get_window_state",
    );
    client.close();
  });
});
