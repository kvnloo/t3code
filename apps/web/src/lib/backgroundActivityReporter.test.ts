import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import {
  createFrameCoalescedInteraction,
  observeBackgroundActivitySubscription,
  retainedBackgroundScopes,
  wasRecentlyInteracted,
} from "./backgroundActivityReporter.ts";

describe("wasRecentlyInteracted", () => {
  it("expires interaction independently of window focus", () => {
    expect(wasRecentlyInteracted(10_000, 55_000)).toBe(true);
    expect(wasRecentlyInteracted(10_000, 55_001)).toBe(false);
  });

  it("rejects future timestamps", () => {
    expect(wasRecentlyInteracted(10_001, 10_000)).toBe(false);
  });

  it.effect("retains an observed subscription until its returned finalizer runs", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-observation-test");
      const scope = { type: "vcs-status" as const, cwd: "/repo" };
      const release = yield* observeBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd },
      });

      expect(retainedBackgroundScopes(environmentId)).toEqual([scope]);

      yield* release;
      expect(retainedBackgroundScopes(environmentId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing environment and scope values distinct", () =>
    Effect.gen(function* () {
      const firstEnvironmentId = EnvironmentId.make("a");
      const secondEnvironmentId = EnvironmentId.make("a:vcs-status:b");
      const releaseFirst = yield* observeBackgroundActivitySubscription({
        environmentId: firstEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeBackgroundActivitySubscription({
        environmentId: secondEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedBackgroundScopes(firstEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedBackgroundScopes(secondEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );
});

describe("createFrameCoalescedInteraction", () => {
  it("coalesces a pointermove storm to one write per presented frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    let nextHandle = 1;
    const onInteraction = vi.fn();
    const gate = createFrameCoalescedInteraction({
      onInteraction,
      requestAnimationFrame: (callback) => {
        callbacks.push(callback);
        return nextHandle++;
      },
      cancelAnimationFrame: () => {},
    });

    for (let i = 0; i < 2_000; i += 1) gate.notePointerMove();
    expect(callbacks).toHaveLength(1);
    expect(onInteraction).not.toHaveBeenCalled();

    callbacks.shift()?.(0);
    expect(onInteraction).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 500; i += 1) gate.notePointerMove();
    callbacks.shift()?.(16);
    for (let i = 0; i < 500; i += 1) gate.notePointerMove();
    callbacks.shift()?.(32);

    expect(onInteraction).toHaveBeenCalledTimes(3);
    expect(callbacks).toHaveLength(0);
  });

  it("records pointerdown immediately without waiting for a frame", () => {
    const onInteraction = vi.fn();
    const gate = createFrameCoalescedInteraction({
      onInteraction,
      requestAnimationFrame: () => {
        throw new Error("pointerdown must not schedule a frame");
      },
      cancelAnimationFrame: () => {},
    });

    gate.noteImmediate();
    expect(onInteraction).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending frame on dispose so cleanup cannot run later", () => {
    let pending: FrameRequestCallback | null = null;
    let handle = 0;
    const cancelled: number[] = [];
    const onInteraction = vi.fn();
    const gate = createFrameCoalescedInteraction({
      onInteraction,
      requestAnimationFrame: (callback) => {
        pending = callback;
        handle += 1;
        return handle;
      },
      cancelAnimationFrame: (id) => {
        cancelled.push(id);
      },
    });

    gate.notePointerMove();
    const scheduled = pending;
    gate.dispose();
    expect(cancelled).toEqual([1]);
    scheduled?.(0);
    expect(onInteraction).not.toHaveBeenCalled();
  });
});
