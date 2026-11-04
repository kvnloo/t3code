import { themeColorToNativeColor, type MobileThemeVariables } from "./mobileTheme";
import {
  enforceTextContrast,
  minimumTextContrast,
  TEXT_CONTRAST_MINIMUM,
} from "./themeContrastAudit";

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

// Primary text roles drawn straight on the tint. The tint must make these read on their own:
// secondary roles are then nudged toward them (`enforceTextContrast`) rather than thickening the
// glass for every faint label.
const PRIMARY_TEXT_ROLES = [
  "--color-foreground",
  "--color-header-foreground",
  "--color-drawer-foreground",
] as const satisfies ReadonlyArray<keyof MobileThemeVariables>;

/**
 * Wallpaper detail behind unblurred glass is sharp, so body text gets AAA (7:1) there; behind a
 * real blur AA (4.5:1) reads as well as on a solid color.
 */
function primaryTextTarget(plan: WindowGlassPlan): number {
  return plan.blurDp > 0 ? TEXT_CONTRAST_MINIMUM : 7;
}

/**
 * Raises the tint just enough that primary text reads over any wallpaper, pure white and pure
 * black included (live wallpapers and photos can be either under any given line of text).
 * The mode's own tint is the floor, so darker wallpapers never get a thinner tint than asked for.
 */
export function readableWindowGlassPlan(
  variables: MobileThemeVariables,
  plan: WindowGlassPlan | null,
): WindowGlassPlan | null {
  if (!plan) return null;
  const target = primaryTextTarget(plan);
  const reads = (tint: number) => {
    const candidate = { ...plan, tint };
    return (
      minimumTextContrast(applyWindowGlass(variables, candidate), PRIMARY_TEXT_ROLES, {
        glassRootColor: windowGlassRootColor(variables, candidate),
      }) >= target
    );
  };
  if (reads(plan.tint)) return plan;
  let low = plan.tint;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (reads(middle)) high = middle;
    else low = middle;
  }
  return { ...plan, tint: Math.ceil(high * 100) / 100 };
}

export interface ReadableTheme {
  readonly variables: MobileThemeVariables;
  /** The tint painted over the wallpaper at the root; undefined for a solid window. */
  readonly glassRootColor: string | undefined;
}

/**
 * The theme as painted: glass applied with a readable tint, then every text role checked against
 * every background it sits on (and, through glass, against black and white wallpaper) and moved
 * just far enough to reach 4.5:1 where it falls short.
 */
export function resolveReadableTheme(
  variables: MobileThemeVariables,
  plan: WindowGlassPlan | null,
): ReadableTheme {
  const readablePlan = readableWindowGlassPlan(variables, plan);
  const glassRootColor = windowGlassRootColor(variables, readablePlan);
  return {
    variables: enforceTextContrast(applyWindowGlass(variables, readablePlan), { glassRootColor }),
    glassRootColor,
  };
}
