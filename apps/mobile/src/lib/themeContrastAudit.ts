import { themeColorToNativeColor, type MobileThemeVariables } from "./mobileTheme";

/**
 * Text-contrast audit for resolved mobile theme variables (WCAG 2.x relative luminance).
 *
 * Every text role is checked against each background it is drawn on. Translucent colors are
 * composited the way Android draws them (straight sRGB "over"), with translucent backgrounds
 * laid over the screen color, or over the worst-case wallpaper when the window is see-through.
 */

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

export const TEXT_CONTRAST_MINIMUM = 4.5;

function parse(color: string): Rgba | null {
  const native = themeColorToNativeColor(color).trim();
  const hex = /^#([\da-f]{6})([\da-f]{2})?$/iu.exec(native);
  if (hex?.[1]) {
    const [r, g, b] = [0, 2, 4].map((offset) =>
      Number.parseInt(hex[1]!.slice(offset, offset + 2), 16),
    );
    const alpha = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
    return [r!, g!, b!, alpha];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/iu.exec(native);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  }
  return null;
}

function over(top: Rgba, bottom: Rgb): Rgb {
  const a = top[3];
  return [0, 1, 2].map((index) => top[index]! * a + bottom[index]! * (1 - a)) as unknown as Rgb;
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Variable = keyof MobileThemeVariables;

/** Text role -> backgrounds it is drawn on. */
export const TEXT_ON_BACKGROUNDS: ReadonlyArray<readonly [Variable, ReadonlyArray<Variable>]> = [
  ...(
    [
      "--color-foreground",
      "--color-foreground-secondary",
      "--color-foreground-muted",
      "--color-foreground-tertiary",
      "--color-placeholder",
      "--color-primary-text",
      "--color-md-body",
      "--color-md-link",
    ] as const
  ).map(
    (text) =>
      [
        text,
        [
          "--color-screen",
          "--color-thread-canvas",
          "--color-card",
          "--color-grouped-card",
          "--color-card-alt",
          "--color-sheet",
        ],
      ] as const,
  ),
  ["--color-header-foreground", ["--color-header"]],
  ["--color-drawer-foreground", ["--color-drawer", "--color-thread-hover"]],
  ["--color-drawer-foreground-muted", ["--color-drawer", "--color-thread-hover"]],
  ["--color-thread-selected-foreground", ["--color-thread-selected"]],
  ["--color-thread-selected-foreground-muted", ["--color-thread-selected"]],
  ["--color-primary-foreground", ["--color-primary"]],
  ["--color-prominent-action-foreground", ["--color-prominent-action"]],
  ["--color-secondary-foreground", ["--color-secondary"]],
  ["--color-user-bubble-foreground", ["--color-user-bubble"]],
  ["--color-user-bubble-foreground-muted", ["--color-user-bubble"]],
  ["--color-inline-skill-foreground", ["--color-inline-skill-background"]],
  ["--color-md-code-text", ["--color-md-code-bg"]],
  ["--color-warning-foreground", ["--color-warning"]],
  ["--color-danger-foreground", ["--color-danger"]],
  ["--color-update-foreground", ["--color-update"]],
];

// Backgrounds painted on top of a card rather than directly on the scene.
const ON_CARD = new Set<Variable>([
  "--color-md-code-bg",
  "--color-inline-skill-background",
  "--color-secondary",
  "--color-warning",
  "--color-danger",
  "--color-update",
]);

export interface ContrastFinding {
  readonly text: Variable;
  readonly background: Variable;
  readonly ratio: number;
}

export interface ContrastAuditOptions {
  /** See-through window: the wallpaper is under the root tint. Checked against black and white. */
  readonly glassRootColor?: string;
}

/** Lowest contrast for each (text, background) pair across every backdrop in play. */
export function auditTextContrast(
  variables: MobileThemeVariables,
  options: ContrastAuditOptions = {},
): ReadonlyArray<ContrastFinding> {
  const findings: ContrastFinding[] = [];
  for (const [text, backgrounds] of TEXT_ON_BACKGROUNDS) {
    const textColor = parse(variables[text]);
    if (!textColor) continue;
    for (const background of backgrounds) {
      const filled = filledBackgrounds(variables, background, options);
      if (filled.length === 0) continue;
      const ratio = Math.min(...filled.map((under) => contrast(over(textColor, under), under)));
      findings.push({ text, background, ratio });
    }
  }
  return findings;
}

/** The opaque colors a background can end up as, one per backdrop (wallpaper extremes). */
function filledBackgrounds(
  variables: MobileThemeVariables,
  background: Variable,
  options: ContrastAuditOptions,
): ReadonlyArray<Rgb> {
  const backgroundColor = parse(variables[background]);
  if (!backgroundColor) return [];
  const screen = parse(variables["--color-screen"]) ?? ([0, 0, 0, 1] as const);
  const root = options.glassRootColor ? parse(options.glassRootColor) : null;
  const backdrops: ReadonlyArray<Rgb> = root
    ? [over(root, [0, 0, 0]), over(root, [255, 255, 255])]
    : [[0, 0, 0]];
  return backdrops.map((backdrop) => {
    const scene = over(screen, backdrop);
    const card = over(parse(variables["--color-card"]) ?? screen, scene);
    return over(backgroundColor, ON_CARD.has(background) ? card : scene);
  });
}

function toHex(color: Rgb): string {
  return `#${color
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [0, 1, 2].map(
    (index) => from[index]! + (to[index]! - from[index]!) * amount,
  ) as unknown as Rgb;
}

/**
 * Moves every text role that misses the minimum on any of its backgrounds toward black or white
 * (whichever reads better there) just far enough to pass everywhere. Roles that already pass are
 * returned unchanged, so solid themes keep their exact colors and hierarchy wherever it reads.
 */
export function enforceTextContrast(
  variables: MobileThemeVariables,
  options: ContrastAuditOptions = {},
  minimum = TEXT_CONTRAST_MINIMUM,
): MobileThemeVariables {
  let next: Record<string, string> | null = null;
  for (const [text, backgrounds] of TEXT_ON_BACKGROUNDS) {
    const textColor = parse(variables[text]);
    if (!textColor) continue;
    const surfaces = backgrounds.flatMap((background) =>
      filledBackgrounds(variables, background, options),
    );
    if (surfaces.length === 0) continue;
    const worst = (color: Rgb) => Math.min(...surfaces.map((surface) => contrast(color, surface)));
    // Translucent text is judged where it lands: over the lightest-contrast surface.
    const landed = surfaces.map((surface) => over(textColor, surface));
    if (Math.min(...landed.map((color, index) => contrast(color, surfaces[index]!))) >= minimum) {
      continue;
    }
    const opaque: Rgb = [textColor[0], textColor[1], textColor[2]];
    const black: Rgb = [0, 0, 0];
    const white: Rgb = [255, 255, 255];
    const target = worst(black) >= worst(white) ? black : white;
    // Search on the 8-bit color that will actually be painted, so rounding can't drop it below.
    const painted = (amount: number) => parse(toHex(mix(opaque, target, amount)))!;
    const passes = (amount: number) => {
      const [r, g, b] = painted(amount);
      return worst([r, g, b]) >= minimum;
    };
    let low = 0;
    let high = 1;
    if (passes(0)) high = 0;
    for (let step = 0; step < 24 && high > 0; step += 1) {
      const middle = (low + high) / 2;
      if (passes(middle)) high = middle;
      else low = middle;
    }
    next ??= { ...variables };
    next[text] = toHex(mix(opaque, target, high));
  }
  return (next ?? variables) as MobileThemeVariables;
}

/** Lowest contrast among the given text roles over every backdrop in play. */
export function minimumTextContrast(
  variables: MobileThemeVariables,
  roles: ReadonlyArray<Variable>,
  options: ContrastAuditOptions = {},
): number {
  return Math.min(
    ...auditTextContrast(variables, options)
      .filter((finding) => roles.includes(finding.text))
      .map((finding) => finding.ratio),
  );
}

export function failingTextContrast(
  variables: MobileThemeVariables,
  options: ContrastAuditOptions = {},
  minimum = TEXT_CONTRAST_MINIMUM,
): ReadonlyArray<ContrastFinding> {
  return auditTextContrast(variables, options).filter((finding) => finding.ratio < minimum - 1e-6);
}
