/**
 * DEV/DEBUG-only counters for frame-pacing investigations.
 * Production builds keep every note*() as a no-op; tests can force enable/disable.
 */

export type FrameInteractionCounterKey =
  | "pointerMovesObserved"
  | "rafInteractionFlushes"
  | "sidebarDragPointerEvents"
  | "sidebarDragOnMoves"
  | "viewportResizePointerEvents"
  | "viewportResizeStateUpdates"
  | "browserSurfaceMeasures"
  | "browserSurfacePresentations";

const emptyCounts = (): Record<FrameInteractionCounterKey, number> => ({
  pointerMovesObserved: 0,
  rafInteractionFlushes: 0,
  sidebarDragPointerEvents: 0,
  sidebarDragOnMoves: 0,
  viewportResizePointerEvents: 0,
  viewportResizeStateUpdates: 0,
  browserSurfaceMeasures: 0,
  browserSurfacePresentations: 0,
});

let counts = emptyCounts();
/** null = follow import.meta.env.DEV; boolean forces on/off for tests. */
let enabledOverride: boolean | null = null;

const isEnabled = () => (enabledOverride === null ? import.meta.env.DEV === true : enabledOverride);

export const frameInteractionCounters = {
  /** Test seam: force counters on/off, or null to restore the DEV default. */
  setEnabledForTests(enabled: boolean | null) {
    enabledOverride = enabled;
  },
  reset() {
    counts = emptyCounts();
  },
  snapshot(): Readonly<Record<FrameInteractionCounterKey, number>> {
    return { ...counts };
  },
  note(key: FrameInteractionCounterKey) {
    if (!isEnabled()) return;
    counts[key] += 1;
  },
};
