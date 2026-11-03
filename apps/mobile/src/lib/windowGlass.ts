import { themeColorToNativeColor, type MobileThemeVariables } from "./mobileTheme";

/**
 * See-through app background (Android): the wallpaper, live wallpapers included, shows behind
 * the app the way a translucent Hyprland window shows the desktop.
 */
export type WindowGlassMode = "off" | "clear" | "frosted";

export const WINDOW_GLASS_MODES: ReadonlyArray<WindowGlassMode> = ["off", "clear", "frosted"];

export interface WindowGlassPlan {
  /** Opacity of the one tint layer painted over the wallpaper at the app root. */
  readonly tint: number;
  /** Opacity of panes (cards, the thread canvas) on top of that tint. */
  readonly pane: number;
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
  if (mode === "clear") return { tint: 0.45, pane: 0.25, blurDp: 0 };
  return blurSupported
    ? { tint: 0.6, pane: 0.3, blurDp: FROSTED_BLUR_DP }
    : { tint: 0.6 + UNBLURRED_TINT_BOOST, pane: 0.3, blurDp: 0 };
}

// Full-screen backgrounds. Several of them stack on every screen (workspace frame, navigator
// content, page), so any alpha here would compound into an opaque wall. They go fully clear and
// the tint is painted once at the root instead (`windowGlassRootColor`).
const SCENE_VARIABLES = [
  "--color-screen",
  "--color-header",
  "--color-drawer",
  "--color-status-bar",
  "--color-sheet",
] as const satisfies ReadonlyArray<keyof MobileThemeVariables>;

// Panes on top of the tint: the glass panels the content sits on.
const PANE_VARIABLES = [
  "--color-thread-canvas",
  "--color-card",
  "--color-grouped-card",
  "--color-card-alt",
  "--color-thread-selected",
  "--color-sidebar-search",
] as const satisfies ReadonlyArray<keyof MobileThemeVariables>;

/**
 * `#RRGGBBAA`, the form runtime-scoped Uniwind variables accept (as Material You uses);
 * `rgba()` strings are ignored there and the compiled opaque theme color wins.
 */
export function colorWithAlphaHex(color: string, alpha: number): string {
  const native = themeColorToNativeColor(color).trim();
  const hex = /^#([\da-f]{6})(?:[\da-f]{2})?$/iu.exec(native)?.[1];
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/iu.exec(native);
  const channels = hex
    ? [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    : rgb
      ? [rgb[1], rgb[2], rgb[3]].map((channel) => Math.round(Number(channel)))
      : null;
  if (!channels) return color;
  return `#${[...channels, Math.round(Math.min(1, Math.max(0, alpha)) * 255)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function applyWindowGlass(
  variables: MobileThemeVariables,
  plan: WindowGlassPlan | null,
): MobileThemeVariables {
  if (!plan) return variables;
  const next: Record<string, string> = { ...variables };
  for (const name of SCENE_VARIABLES) next[name] = colorWithAlphaHex(variables[name], 0);
  for (const name of PANE_VARIABLES) next[name] = colorWithAlphaHex(variables[name], plan.pane);
  return next as MobileThemeVariables;
}

/** The single tint layer over the wallpaper, from the theme's own screen color. */
export function windowGlassRootColor(
  variables: MobileThemeVariables,
  plan: WindowGlassPlan | null,
): string | undefined {
  return plan ? colorWithAlphaHex(variables["--color-screen"], plan.tint) : undefined;
}
