import { describe, expect, it, vi } from "vite-plus/test";

import { resizeBrowserViewportFromRail } from "./browserViewportLayout";
import { createLatestPointerFrame } from "./latestPointerFrame";

describe("createLatestPointerFrame", () => {
  it("applies at most one latest sample per presented frame during a move storm", () => {
    const callbacks: FrameRequestCallback[] = [];
    let nextHandle = 1;
    const applied: Array<{ clientX: number; clientY: number }> = [];
    const frame = createLatestPointerFrame({
      apply: (point) => applied.push(point),
      requestAnimationFrame: (callback) => {
        callbacks.push(callback);
        return nextHandle++;
      },
      cancelAnimationFrame: () => {},
    });

    for (let i = 0; i < 1_000; i += 1) {
      frame.record({ clientX: i, clientY: i * 2 });
    }
    expect(callbacks).toHaveLength(1);
    expect(applied).toHaveLength(0);

    callbacks.shift()?.(0);
    expect(applied).toEqual([{ clientX: 999, clientY: 1998 }]);

    for (let i = 0; i < 100; i += 1) {
      frame.record({ clientX: 1_000 + i, clientY: 0 });
    }
    callbacks.shift()?.(16);
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ clientX: 1_099, clientY: 0 });
  });

  it("flush applies the latest sample synchronously and cancels the pending frame", () => {
    let pending: FrameRequestCallback | null = null;
    const cancelled: number[] = [];
    const applied: Array<{ clientX: number; clientY: number }> = [];
    const frame = createLatestPointerFrame({
      apply: (point) => applied.push(point),
      requestAnimationFrame: (callback) => {
        pending = callback;
        return 7;
      },
      cancelAnimationFrame: (handle) => {
        cancelled.push(handle);
        pending = null;
      },
    });

    for (let i = 0; i < 50; i += 1) frame.record({ clientX: i, clientY: 10 });
    frame.record({ clientX: 120, clientY: 40 });
    frame.flush();

    expect(cancelled).toEqual([7]);
    expect(applied).toEqual([{ clientX: 120, clientY: 40 }]);
    pending?.(0);
    expect(applied).toHaveLength(1);
  });

  it("cancel drops pending work so a late frame cannot apply stale coords", () => {
    let pending: FrameRequestCallback | null = null;
    const applied = vi.fn();
    const frame = createLatestPointerFrame({
      apply: applied,
      requestAnimationFrame: (callback) => {
        pending = callback;
        return 3;
      },
      cancelAnimationFrame: () => {},
    });

    frame.record({ clientX: 9, clientY: 9 });
    const scheduled = pending;
    frame.cancel();
    scheduled?.(0);
    expect(applied).not.toHaveBeenCalled();
  });

  it("flushed final dims match an unthrottled resize for the same pointer sample", () => {
    const start = { width: 800, height: 600 };
    const available = { width: 1000, height: 800 };
    const startX = 100;
    const startY = 100;
    const direction = "southeast" as const;
    const zoomFactor = 1;
    const aspectRatio = 4 / 3;

    const applied: Array<{ width: number; height: number }> = [];
    const callbacks: FrameRequestCallback[] = [];
    let nextHandle = 1;
    const frame = createLatestPointerFrame({
      apply: (point) => {
        applied.push(
          resizeBrowserViewportFromRail(
            start,
            { x: point.clientX - startX, y: point.clientY - startY },
            available,
            zoomFactor,
            direction,
            aspectRatio,
          ),
        );
      },
      requestAnimationFrame: (callback) => {
        callbacks.push(callback);
        return nextHandle++;
      },
      cancelAnimationFrame: () => {},
    });

    for (let i = 1; i <= 1_000; i += 1) {
      frame.record({ clientX: startX + i, clientY: startY + i });
    }
    // pointerup-equivalent flush of the final sample
    frame.record({ clientX: startX + 1_000, clientY: startY + 1_000 });
    frame.flush();

    const expected = resizeBrowserViewportFromRail(
      start,
      { x: 1_000, y: 1_000 },
      available,
      zoomFactor,
      direction,
      aspectRatio,
    );
    expect(applied.length).toBeLessThanOrEqual(1);
    expect(applied.at(-1)).toEqual(expected);
    expect(expected.width / expected.height).toBeCloseTo(aspectRatio, 2);
  });
});
