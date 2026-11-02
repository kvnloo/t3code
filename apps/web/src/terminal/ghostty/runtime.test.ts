import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import wasmDataUrl from "./vendor/ghostty-vt.wasm?inline";
import writePtyWasmDataUrl from "./vendor/ghostty-write-pty.wasm?inline";

function decodeWasmDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> {
  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) throw new Error("The vendored Ghostty WASM data URL is invalid");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

const wasm = decodeWasmDataUrl(wasmDataUrl);
const writePtyWasm = decodeWasmDataUrl(writePtyWasmDataUrl);

type Download = "serve" | "stall";

/** Answers like `fetch`: a stalled download only ends when its signal aborts. */
function stubDownloads(plan: { vt: Download; writePty: Download }) {
  let onStall = () => {};
  const stalled = new Promise<void>((resolve) => {
    onStall = resolve;
  });
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const isWritePty = String(url).includes("write-pty");
    if ((isWritePty ? plan.writePty : plan.vt) === "serve") {
      return Promise.resolve(new Response(isWritePty ? writePtyWasm : wasm));
    }
    onStall();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, stalled };
}

async function freshRuntimeModule() {
  vi.resetModules();
  return import("./runtime");
}

function track<T>(promise: Promise<T>) {
  const state: { settled: "pending" | "resolved" | "rejected"; error?: unknown } = {
    settled: "pending",
  };
  promise.then(
    () => {
      state.settled = "resolved";
    },
    (error: unknown) => {
      state.settled = "rejected";
      state.error = error;
    },
  );
  return state;
}

describe("loadGhosttyRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up on a stalled runtime download so the next terminal open retries", async () => {
    const plan = { vt: "stall" as Download, writePty: "serve" as Download };
    const { fetch, stalled } = stubDownloads(plan);
    const { GhosttyRuntime, loadGhosttyRuntime } = await freshRuntimeModule();

    const first = track(loadGhosttyRuntime());
    await stalled;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(first.settled).toBe("rejected");
    expect(String(first.error)).toMatch(/libghostty-vt/);

    plan.vt = "serve";
    await expect(loadGhosttyRuntime()).resolves.toBeInstanceOf(GhosttyRuntime);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up on a stalled PTY trampoline download", async () => {
    const { stalled } = stubDownloads({ vt: "serve", writePty: "stall" });
    const { loadGhosttyRuntime } = await freshRuntimeModule();

    const load = track(loadGhosttyRuntime());
    await stalled;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load.settled).toBe("rejected");
  });

  it("leaves a download that finishes in time alone", async () => {
    const { fetch } = stubDownloads({ vt: "serve", writePty: "serve" });
    const { GhosttyRuntime, loadGhosttyRuntime } = await freshRuntimeModule();

    const runtime = await loadGhosttyRuntime();
    expect(runtime).toBeInstanceOf(GhosttyRuntime);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await loadGhosttyRuntime()).toBe(runtime);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
