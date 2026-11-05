import { describe, expect, it } from "vite-plus/test";

import { workspaceSidebarOpacity } from "./workspace-sidebar-opacity";

const base = { workspacePageOpen: false, floatingTabsEnabled: false, sidebarWidth: 320 };

describe("workspace sidebar opacity", () => {
  it("hides the retained Android list under a workspace page, whatever its width", () => {
    expect(workspaceSidebarOpacity({ ...base, platform: "android", workspacePageOpen: true })).toBe(
      0,
    );
    expect(
      workspaceSidebarOpacity({
        ...base,
        platform: "android",
        workspacePageOpen: true,
        floatingTabsEnabled: true,
      }),
    ).toBe(0);
  });

  it("restores the width-based fade when the Android page closes", () => {
    expect(workspaceSidebarOpacity({ ...base, platform: "android" })).toBe(1);
    expect(workspaceSidebarOpacity({ ...base, platform: "android", sidebarWidth: 40 })).toBe(0.5);
    expect(
      workspaceSidebarOpacity({
        ...base,
        platform: "android",
        sidebarWidth: 40,
        floatingTabsEnabled: true,
      }),
    ).toBe(1);
  });

  it("never fades the iOS sidebar, even under a page", () => {
    expect(workspaceSidebarOpacity({ ...base, platform: "ios", workspacePageOpen: true })).toBe(1);
    expect(workspaceSidebarOpacity({ ...base, platform: "ios", sidebarWidth: 0 })).toBe(1);
  });
});
