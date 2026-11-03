import type { MaterialYouPalette, MaterialYouPalettes } from "./materialYouPalette";
import { themeColorWithContrast } from "./mobileTheme";

/**
 * Colors pushed from a desktop theme (Noctalia / matugen / pywal `colors.json`, Hyprland dotfiles).
 * Only the three seeds are required; every other role is derived from them when absent.
 */
export interface DesktopColors {
  readonly surface: string;
  readonly onSurface: string;
  readonly primary: string;
  readonly onPrimary?: string;
  readonly surfaceVariant?: string;
  readonly onSurfaceVariant?: string;
  readonly secondary?: string;
  readonly onSecondary?: string;
  readonly tertiary?: string;
  readonly onTertiary?: string;
  readonly error?: string;
  readonly onError?: string;
  readonly outline?: string;
  readonly shadow?: string;
}

const ROLES = [
  "surface",
  "onSurface",
  "primary",
  "onPrimary",
  "surfaceVariant",
  "onSurfaceVariant",
  "secondary",
  "onSecondary",
  "tertiary",
  "onTertiary",
  "error",
  "onError",
  "outline",
  "shadow",
] as const satisfies ReadonlyArray<keyof DesktopColors>;

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^#?([\da-f]{6})$/iu.exec(value.trim());
  return match?.[1] ? `#${match[1].toLowerCase()}` : null;
}

/**
 * Accepts Noctalia's `mSurface`-style keys or plain `surface` keys, with or without `#`
 * (adb's device shell drops everything after `#`, so senders strip it).
 */
export function parseDesktopColors(raw: unknown): DesktopColors | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const colors: Partial<Record<keyof DesktopColors, string>> = {};
  for (const role of ROLES) {
    const noctaliaKey = `m${role[0]!.toUpperCase()}${role.slice(1)}`;
    const value = normalizeHex(record[role]) ?? normalizeHex(record[noctaliaKey]);
    if (value) colors[role] = value;
  }
  if (!colors.surface || !colors.onSurface || !colors.primary) return null;
  return colors as DesktopColors;
}

function channels(color: string): readonly [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Straight sRGB mix, so derived roles keep the desktop's hues instead of re-toning them. */
export function mixHex(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((channel, index) =>
      Math.round(channel + (b[index]! - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function desktopColorsToPalette(colors: DesktopColors): MaterialYouPalette {
  const { surface, onSurface, primary } = colors;
  const secondary = colors.secondary ?? primary;
  const tertiary = colors.tertiary ?? secondary;
  const error = colors.error ?? "#e5484d";
  const onSurfaceVariant = colors.onSurfaceVariant ?? mixHex(onSurface, surface, 0.25);
  const primaryContainer = mixHex(surface, primary, 0.3);
  const secondaryContainer = mixHex(surface, secondary, 0.22);
  const tertiaryContainer = mixHex(surface, tertiary, 0.22);
  const errorContainer = mixHex(surface, error, 0.3);
  return {
    primary,
    onPrimary: colors.onPrimary ?? themeColorWithContrast(surface, primary),
    primaryContainer,
    onPrimaryContainer: themeColorWithContrast(mixHex(primary, onSurface, 0.4), primaryContainer),
    inversePrimary: mixHex(primary, surface, 0.35),
    secondaryContainer,
    onSecondaryContainer: themeColorWithContrast(onSurface, secondaryContainer),
    tertiary,
    tertiaryContainer,
    onTertiaryContainer: themeColorWithContrast(onSurface, tertiaryContainer),
    surface,
    onSurface,
    onSurfaceVariant,
    surfaceContainerLowest: mixHex(surface, "#000000", 0.2),
    surfaceContainerLow: mixHex(surface, onSurface, 0.03),
    surfaceContainer: colors.surfaceVariant ?? mixHex(surface, onSurface, 0.06),
    surfaceContainerHigh: mixHex(surface, onSurface, 0.1),
    surfaceContainerHighest: mixHex(surface, onSurface, 0.15),
    errorContainer,
    onErrorContainer: themeColorWithContrast(colors.onError ?? onSurface, errorContainer),
    outline: colors.outline ?? mixHex(surface, onSurface, 0.4),
    outlineVariant: mixHex(surface, onSurface, 0.2),
    scrim: colors.shadow ?? "#000000",
  };
}

/** A desktop theme has one palette; both appearances use it. */
export function desktopColorsToPalettes(colors: DesktopColors | null): MaterialYouPalettes | null {
  if (!colors) return null;
  const palette = desktopColorsToPalette(colors);
  return { light: palette, dark: palette };
}
