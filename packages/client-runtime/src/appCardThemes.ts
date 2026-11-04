/**
 * App card themes copied from each app's design system: GitHub from Primer, Uber from Base Web (Inter
 * Tight stands in for the private Uber Move), Gmail and Maps from Google's Material 3. Web maps a theme
 * to CSS variables; mobile reads it directly.
 */
import type { AppBrandId } from "./appConnectors.ts";

export type AppCardFont = "google-sans" | "inter-tight" | "mona-sans";

export interface AppCardTheme {
  readonly font: AppCardFont;
  /** Card container. */
  readonly surface: string;
  /** Inset areas: read mail rows, selected rows, check lists. */
  readonly surfaceAlt: string;
  readonly onSurface: string;
  readonly muted: string;
  readonly outline: string;
  /** Primary action fill and its text. */
  readonly primary: string;
  readonly onPrimary: string;
  /** Tonal action / selected fill and its text. */
  readonly container: string;
  readonly onContainer: string;
  /** Links and focus. */
  readonly accent: string;
  readonly success: string;
  readonly warning: string;
  readonly warningSurface: string;
  readonly danger: string;
  readonly done: string;
  readonly radius: number;
}

type ThemePair = { readonly light: AppCardTheme; readonly dark: AppCardTheme };

const GOOGLE: ThemePair = {
  light: {
    font: "google-sans",
    surface: "#ffffff",
    surfaceAlt: "#f2f6fc",
    onSurface: "#1f1f1f",
    muted: "#444746",
    outline: "#c4c7c5",
    primary: "#0b57d0",
    onPrimary: "#ffffff",
    container: "#c2e7ff",
    onContainer: "#001d35",
    accent: "#0b57d0",
    success: "#188038",
    warning: "#b06000",
    warningSurface: "#fef7e0",
    danger: "#b3261e",
    done: "#0b57d0",
    radius: 16,
  },
  dark: {
    font: "google-sans",
    surface: "#1e1f20",
    surfaceAlt: "#282a2c",
    onSurface: "#e3e3e3",
    muted: "#c4c7c5",
    outline: "#444746",
    primary: "#a8c7fa",
    onPrimary: "#062e6f",
    container: "#004a77",
    onContainer: "#c2e7ff",
    accent: "#a8c7fa",
    success: "#6dd58c",
    warning: "#fdd663",
    warningSurface: "#3d3000",
    danger: "#f2b8b5",
    done: "#a8c7fa",
    radius: 16,
  },
};

const BASE: ThemePair = {
  light: {
    font: "inter-tight",
    surface: "#ffffff",
    surfaceAlt: "#f3f3f3",
    onSurface: "#000000",
    muted: "#5e5e5e",
    outline: "#e8e8e8",
    primary: "#000000",
    onPrimary: "#ffffff",
    container: "#f3f3f3",
    onContainer: "#000000",
    accent: "#276ef1",
    success: "#0e8345",
    warning: "#9f6402",
    warningSurface: "#fdf2dc",
    danger: "#de1135",
    done: "#000000",
    radius: 12,
  },
  dark: {
    font: "inter-tight",
    surface: "#161616",
    surfaceAlt: "#292929",
    onSurface: "#dedede",
    muted: "#ababab",
    outline: "#383838",
    primary: "#dedede",
    onPrimary: "#000000",
    container: "#292929",
    onContainer: "#dedede",
    accent: "#5e8bdb",
    success: "#5c9d70",
    warning: "#f6bc2f",
    warningSurface: "#3a2d0b",
    danger: "#de5b5d",
    done: "#dedede",
    radius: 12,
  },
};

const PRIMER: ThemePair = {
  light: {
    font: "mona-sans",
    surface: "#ffffff",
    surfaceAlt: "#f6f8fa",
    onSurface: "#1f2328",
    muted: "#59636e",
    outline: "#d1d9e0",
    primary: "#1f883d",
    onPrimary: "#ffffff",
    container: "#ddf4ff",
    onContainer: "#0969da",
    accent: "#0969da",
    success: "#1a7f37",
    warning: "#9a6700",
    warningSurface: "#fff8c5",
    danger: "#d1242f",
    done: "#8250df",
    radius: 12,
  },
  dark: {
    font: "mona-sans",
    surface: "#0d1117",
    surfaceAlt: "#151b23",
    onSurface: "#f0f6fc",
    muted: "#9198a1",
    outline: "#3d444d",
    primary: "#238636",
    onPrimary: "#ffffff",
    container: "#388bfd1a",
    onContainer: "#4493f8",
    accent: "#4493f8",
    success: "#3fb950",
    warning: "#d29922",
    warningSurface: "#bb800926",
    danger: "#f85149",
    done: "#ab7df8",
    radius: 12,
  },
};

const LYFT: ThemePair = {
  light: { ...BASE.light, primary: "#ff00bf", onPrimary: "#ffffff", accent: "#ff00bf" },
  dark: { ...BASE.dark, primary: "#ff00bf", onPrimary: "#ffffff", accent: "#ff5fd5" },
};

export const APP_CARD_THEMES: Readonly<Partial<Record<AppBrandId, ThemePair>>> = {
  gmail: GOOGLE,
  "google-maps": GOOGLE,
  "google-calendar": GOOGLE,
  uber: BASE,
  lyft: LYFT,
  github: PRIMER,
};

export function appCardTheme(app: AppBrandId, scheme: "light" | "dark"): AppCardTheme {
  return (APP_CARD_THEMES[app] ?? GOOGLE)[scheme];
}

/** Google Maps' map palette (measured on google.com/maps): land, water, park, route and its casing. */
export const MAP_PAINT = {
  light: {
    land: "#f7f7f7",
    route: "#0b57d0",
    routeCasing: "#0842a0",
    ink: "#1f1f1f",
    startFill: "#ffffff",
    imageFilter: "none",
    pin: "#ea4335",
    pinCore: "#a50e0e",
  },
  dark: {
    land: "#1f2835",
    route: "#8ab4f8",
    routeCasing: "#4285f4",
    ink: "#e3e3e3",
    startFill: "#1f2835",
    imageFilter: "invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(0.6)",
    pin: "#ea4335",
    pinCore: "#a50e0e",
  },
} as const;

/**
 * A [lat, lon] path projected into a w x h box (Web Mercator). Fits the path itself, padded, or the
 * [south, west, north, east] bounds of a basemap image drawn edge to edge in the same box.
 */
export function projectPath(
  path: ReadonlyArray<readonly [number, number]>,
  w: number,
  h: number,
  pad = 16,
  bounds?: readonly [number, number, number, number],
) {
  if (path.length === 0) return { points: [] as Array<[number, number]>, d: "" };
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const xs = path.map(([, lon]) => (lon * Math.PI) / 180);
  const ys = path.map(([lat]) => merc(lat));
  const [x0, x1, y0, y1] = bounds
    ? [(bounds[1] * Math.PI) / 180, (bounds[3] * Math.PI) / 180, merc(bounds[0]), merc(bounds[2])]
    : [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inset = bounds ? 0 : pad;
  const span = Math.max((x1 - x0) / (w - inset * 2), (y1 - y0) / (h - inset * 2)) || 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const points = xs.map((x, i): [number, number] => [
    Math.round(((x - cx) / span + w / 2) * 10) / 10,
    Math.round(((cy - ys[i]!) / span + h / 2) * 10) / 10,
  ]);
  return { points, d: "M" + points.map(([x, y]) => `${x} ${y}`).join(" L") };
}
