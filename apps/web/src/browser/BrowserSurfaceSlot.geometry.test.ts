import { describe, expect, it, vi } from "vite-plus/test";

import { measureBrowserSurfaceSlot, presentBrowserSurfaceSlot } from "./BrowserSurfaceSlot";

describe("BrowserSurfaceSlot geometry seams", () => {
  it("presentation-only updates reuse a cached rect without measuring", () => {
    const measure = vi.fn(() => {
      throw new Error("presentation-only updates must not measure");
    });
    const present = vi.fn(() => true);
    const lease = {
      present,
      release: vi.fn(),
    };
    const rect = { x: 10, y: 20, width: 300, height: 200 };

    const next = presentBrowserSurfaceSlot(
      lease,
      rect,
      { visible: true, cornerRadius: 8, zIndex: 40 },
      () => {
        measure();
        return lease;
      },
    );

    expect(next).toBe(lease);
    expect(measure).not.toHaveBeenCalled();
    expect(present).toHaveBeenCalledExactlyOnceWith(rect, true, 8, 40);

    presentBrowserSurfaceSlot(lease, rect, { visible: false, cornerRadius: 8, zIndex: 40 }, () => {
      measure();
      return lease;
    });
    expect(measure).not.toHaveBeenCalled();
    expect(present).toHaveBeenLastCalledWith(rect, false, 8, 40);
  });

  it("measureBrowserSurfaceSlot rounds getBoundingClientRect once", () => {
    const element = {
      getBoundingClientRect: vi.fn(() => ({ x: 1.4, y: 2.6, width: 100.2, height: 50.8 })),
    } as unknown as HTMLElement;

    expect(measureBrowserSurfaceSlot(element)).toEqual({
      x: 1,
      y: 3,
      width: 100,
      height: 51,
    });
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
  });
});
