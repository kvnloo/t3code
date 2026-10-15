import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { GhosttyRuntime } from "./runtime";

vi.mock("./vendor/ghostty-vt.wasm?url", () => ({ default: "ghostty-vt.wasm" }));
vi.mock("./vendor/ghostty-write-pty.wasm?url&no-inline", () => ({
  default: "ghostty-write-pty.wasm",
}));

describe("GhosttyRuntime.load", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects instead of hanging forever when the wasm download stalls", async () => {
    // Regression test: the two wasm fetches used to have no timeout, so a
    // stalled response parked `load()` (and, via the cached runtimePromise in
    // loadGhosttyRuntime, every terminal open) forever. Virtual timers plus a
    // bounded microtask drain prove the bound with no wall-clock waiting.
    vi.useFakeTimers();
    // A download that never produces a byte: the connection is open but the
    // server never answers. The abort signal is the only way out.
    const stalledFetch = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal("fetch", stalledFetch);

    // Attach handlers up front so the rejection is observed, never unhandled.
    const load = GhosttyRuntime.load();
    const outcomes: Array<"resolved" | "rejected"> = [];
    load.then(
      () => outcomes.push("resolved"),
      () => outcomes.push("rejected"),
    );

    // Prove it starts out pending, not already settled by the mock setup.
    for (let i = 0; i < 10 && outcomes.length === 0; i++) {
      await Promise.resolve();
    }
    expect(outcomes).toEqual([]);

    // Past the fetch deadline: the load must fail loudly so the caller can
    // retry, instead of parking every terminal on a promise that never
    // settles. On the unfixed base the fetch never rejects, so `outcomes`
    // stays empty and this fails instead of hanging.
    await vi.advanceTimersByTimeAsync(60_000);
    for (let i = 0; i < 100 && outcomes.length === 0; i++) {
      await Promise.resolve();
    }
    expect(outcomes).toEqual(["rejected"]);
    expect(stalledFetch).toHaveBeenCalledTimes(1);
  });
});
