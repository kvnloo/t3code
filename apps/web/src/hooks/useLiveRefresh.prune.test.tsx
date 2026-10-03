// @vitest-environment jsdom
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { getLiveRefreshTrackedViewCount, useLiveRefresh } from "./useLiveRefresh";

function UnkeyedProbe() {
  useLiveRefresh(() => {});
  return null;
}

function KeyedProbe({ viewKey }: { readonly viewKey: string }) {
  useLiveRefresh(() => {}, { key: viewKey });
  return null;
}

describe("useLiveRefresh view bookkeeping", () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
  });

  it("drops the useId fallback entry when its mount unmounts", () => {
    const before = getLiveRefreshTrackedViewCount();
    act(() => {
      renderer = create(<UnkeyedProbe />);
    });
    expect(getLiveRefreshTrackedViewCount()).toBe(before + 1);
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    // A useId names one mount: no later mount can look it up again, so keeping
    // it would leak one entry per remount (e.g. every visit to the
    // pull-requests route).
    expect(getLiveRefreshTrackedViewCount()).toBe(before);
  });

  it("keeps a caller-supplied key across unmounts", () => {
    const viewKey = `test-view-${Date.now()}`;
    const before = getLiveRefreshTrackedViewCount();
    act(() => {
      renderer = create(<KeyedProbe viewKey={viewKey} />);
    });
    expect(getLiveRefreshTrackedViewCount()).toBe(before + 1);
    act(() => {
      renderer?.unmount();
    });
    renderer = undefined;
    // A caller-supplied key names a view that outlives its mounts (one panel
    // showing a different pull request each time it opens), so its timestamp
    // stays for the next arrival.
    expect(getLiveRefreshTrackedViewCount()).toBe(before + 1);
  });
});
