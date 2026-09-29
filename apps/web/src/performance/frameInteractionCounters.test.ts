import { afterEach, describe, expect, it } from "vite-plus/test";

import { frameInteractionCounters } from "./frameInteractionCounters";

afterEach(() => {
  frameInteractionCounters.reset();
  frameInteractionCounters.setEnabledForTests(null);
});

describe("frameInteractionCounters", () => {
  it("can be forced quiet even when DEV would enable counting", () => {
    frameInteractionCounters.setEnabledForTests(false);
    frameInteractionCounters.note("pointerMovesObserved");
    expect(frameInteractionCounters.snapshot().pointerMovesObserved).toBe(0);
  });

  it("counts enabled notes and resets cleanly", () => {
    frameInteractionCounters.setEnabledForTests(true);
    frameInteractionCounters.note("pointerMovesObserved");
    frameInteractionCounters.note("pointerMovesObserved");
    frameInteractionCounters.note("rafInteractionFlushes");
    frameInteractionCounters.note("sidebarDragPointerEvents");
    frameInteractionCounters.note("sidebarDragOnMoves");
    frameInteractionCounters.note("viewportResizePointerEvents");
    frameInteractionCounters.note("viewportResizeStateUpdates");
    frameInteractionCounters.note("browserSurfaceMeasures");
    frameInteractionCounters.note("browserSurfacePresentations");

    expect(frameInteractionCounters.snapshot()).toEqual({
      pointerMovesObserved: 2,
      rafInteractionFlushes: 1,
      sidebarDragPointerEvents: 1,
      sidebarDragOnMoves: 1,
      viewportResizePointerEvents: 1,
      viewportResizeStateUpdates: 1,
      browserSurfaceMeasures: 1,
      browserSurfacePresentations: 1,
    });

    frameInteractionCounters.reset();
    expect(frameInteractionCounters.snapshot().pointerMovesObserved).toBe(0);
  });
});
