/**
 * A see-through Android page cannot occlude the retained sidebar under it, so hide its pixels.
 * iOS never fades it: fading a UIKit glass ancestor can drop remounted header effects.
 */
export function workspaceSidebarOpacity(input: {
  readonly platform: string;
  readonly workspacePageOpen: boolean;
  readonly floatingTabsEnabled: boolean;
  readonly stripSidebar: boolean;
  readonly sidebarWidth: number;
}): number {
  "worklet";
  if (input.platform === "android" && input.workspacePageOpen) return 0;
  if (input.platform === "ios" || input.floatingTabsEnabled || input.stripSidebar) return 1;
  return Math.min(1, input.sidebarWidth / 80);
}
