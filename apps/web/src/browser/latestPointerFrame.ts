import { frameInteractionCounters } from "../performance/frameInteractionCounters";

/** Keep the latest pointer sample and flush at most once per presented frame. */
export function createLatestPointerFrame(options: {
  readonly apply: (point: { readonly clientX: number; readonly clientY: number }) => void;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
}) {
  const schedule =
    options.requestAnimationFrame ??
    ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancel =
    options.cancelAnimationFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let pending: { clientX: number; clientY: number } | null = null;
  let frame = 0;
  let generation = 0;

  const flushPending = () => {
    const latest = pending;
    pending = null;
    if (!latest) return;
    frameInteractionCounters.note("viewportResizeStateUpdates");
    options.apply(latest);
  };

  return {
    record(point: { readonly clientX: number; readonly clientY: number }) {
      frameInteractionCounters.note("viewportResizePointerEvents");
      pending = { clientX: point.clientX, clientY: point.clientY };
      if (frame !== 0) return;
      const scheduledGeneration = generation;
      frame = schedule(() => {
        frame = 0;
        if (scheduledGeneration !== generation) return;
        flushPending();
      });
    },
    /** Apply the latest sample synchronously and drop any scheduled frame. */
    flush() {
      if (frame !== 0) {
        cancel(frame);
        frame = 0;
      }
      flushPending();
    },
    /** Drop pending work without applying. */
    cancel() {
      generation += 1;
      if (frame !== 0) {
        cancel(frame);
        frame = 0;
      }
      pending = null;
    },
  };
}
