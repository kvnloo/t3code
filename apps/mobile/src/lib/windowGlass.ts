import {
  themeColorToNativeColor,
  themeColorWithAlpha,
  type MobileThemeVariables,
} from "./mobileTheme";

/**
 * See-through app background (Android): the wallpaper, live wallpapers included, shows behind
 * the app the way a translucent Hyprland window shows the desktop.
 */
export type WindowGlassMode = "off" | "clear" | "frosted";

export const WINDOW_GLASS_MODES: ReadonlyArray<WindowGlassMode> = ["off", "clear", "frosted"];

export interface WindowGlassPlan {
  /** Opacity of full-screen backgrounds over the wallpaper. */
  readonly tint: number;
  /** Requested window background blur; 0 when the device cannot blur other windows. */
  readonly blurDp: number;
}

// The blur covers the whole window, so one radius is enough; 28dp reads as frosted on a phone.
const FROSTED_BLUR_DP = 28;
// Without blur, wallpaper detail stays sharp behind text, so the tint has to carry legibility.
const UNBLURRED_TINT_BOOST = 0.12;

export function normalizeWindowGlassMode(value: unknown): WindowGlassMode {
  return value === "clear" || value === "frosted" ? value : "off";
}

export function resolveWindowGlassPlan(
  mode: WindowGlassMode,
  blurSupported: boolean,
): WindowGlassPlan | null {
  if (mode === "off") return null;
  if (mode === "clear") return { tint: 0.5, blurDp: 0 };
  return blurSupported
    ? { tint: 0.62, blurDp: FROSTED_BLUR_DP }
    : { tint: 0.62 + UNBLURRED_TINT_BOOST, blurDp: 0 };
}

// Full-screen backgrounds: these must let the wallpaper through.
const SCENE_VARIABLES = [
  "--color-screen",
  "--color-thread-canvas",
  "--color-drawer",
  "--color-status-bar",
] as const satisfies ReadonlyArray<keyof MobileThemeVariables>;

// Panels on top of the scene stay a little denser so grouped content still reads as a pane.
// Android pushes most secondary pages as full-screen `bg-sheet` pages, so sheets join the panels.
const PANEL_VARIABLES = [
  "--color-sheet",
  "--color-header",
  "--color-card",
  "--color-grouped-card",
  "--color-card-alt",
  "--color-thread-selected",
  "--color-sidebar-search",
] as const satisfies ReadonlyArray<keyof MobileThemeVariables>;

export function applyWindowGlass(
  variables: MobileThemeVariables,
  plan: WindowGlassPlan | null,
): MobileThemeVariables {
  if (!plan) return variables;
  const next: Record<string, string> = { ...variables };
  const panelAlpha = Math.min(0.92, plan.tint + 0.2);
  for (const name of SCENE_VARIABLES) {
    next[name] = themeColorWithAlpha(themeColorToNativeColor(variables[name]), plan.tint);
  }
  for (const name of PANEL_VARIABLES) {
    next[name] = themeColorWithAlpha(themeColorToNativeColor(variables[name]), panelAlpha);
  }
  return next as MobileThemeVariables;
}
