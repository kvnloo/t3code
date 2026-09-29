"use client";

import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface, type BrowserSurfaceRect } from "./browserSurfaceStore";

export type BrowserSurfaceSlotPresentation = {
  readonly visible: boolean;
  readonly cornerRadius: number;
  readonly zIndex: number;
};

/** Present a cached slot rect without reading layout geometry. */
export function presentBrowserSurfaceSlot(
  lease: {
    present: (
      rect: BrowserSurfaceRect,
      visible: boolean,
      cornerRadius?: number,
      zIndex?: number,
    ) => boolean;
    release: () => void;
  },
  rect: BrowserSurfaceRect,
  presentation: BrowserSurfaceSlotPresentation,
  reacquire: () => {
    present: (
      rect: BrowserSurfaceRect,
      visible: boolean,
      cornerRadius?: number,
      zIndex?: number,
    ) => boolean;
    release: () => void;
  },
): {
  present: (
    rect: BrowserSurfaceRect,
    visible: boolean,
    cornerRadius?: number,
    zIndex?: number,
  ) => boolean;
  release: () => void;
} {
  const presented = lease.present(
    rect,
    presentation.visible && rect.width > 0 && rect.height > 0,
    presentation.cornerRadius,
    presentation.zIndex,
  );
  if (presentation.visible && !presented) {
    lease.release();
    const next = reacquire();
    next.present(
      rect,
      rect.width > 0 && rect.height > 0,
      presentation.cornerRadius,
      presentation.zIndex,
    );
    return next;
  }
  return lease;
}

/** Read slot geometry once; callers cache it across presentation-only updates. */
export function measureBrowserSurfaceSlot(element: HTMLElement): BrowserSurfaceRect {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const cachedRectRef = useRef<BrowserSurfaceRect | null>(null);
  const layoutVersionRef = useRef(layoutVersion);
  const presentRef = useRef<(() => void) | null>(null);
  const measureAndPresentRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const presentCached = () => {
      const rect = cachedRectRef.current;
      if (!rect) return;
      lease = presentBrowserSurfaceSlot(lease, rect, presentationRef.current, () =>
        acquireBrowserSurface(tabId, fitSourceContent),
      );
    };
    const measureAndPresent = () => {
      cachedRectRef.current = measureBrowserSurfaceSlot(element);
      presentCached();
    };
    let frameId = 0;
    const scheduleMeasure = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        measureAndPresent();
      });
    };

    presentRef.current = presentCached;
    measureAndPresentRef.current = measureAndPresent;
    measureAndPresent();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    // Inline panels animate their outer width while keeping the content at
    // full width. The slot moves without resizing, so measure on shell resizes too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observer.observe(panel);
    // Captured scroll can fire for every descendant scroller. Geometry only
    // needs one sample per paint, so coalesce layout reads to the next frame.
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      if (presentRef.current === presentCached) presentRef.current = null;
      if (measureAndPresentRef.current === measureAndPresent) measureAndPresentRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    // layoutVersion can move the slot without a ResizeObserver entry.
    // Visibility / corner / z changes only need the cached rect.
    if (layoutVersionRef.current !== layoutVersion) {
      layoutVersionRef.current = layoutVersion;
      measureAndPresentRef.current?.();
      return;
    }
    presentRef.current?.();
  }, [cornerRadius, layoutVersion, visible, zIndex]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
