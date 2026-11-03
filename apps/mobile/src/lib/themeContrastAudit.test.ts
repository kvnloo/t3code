import { describe, expect, it } from "vite-plus/test";

import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { desktopColorsToPalette, paletteAppearance, parseDesktopColors } from "./desktopColors";
import { materialYouPaletteToMobileThemeVariables } from "./materialYouTheme.android";
import {
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeVariables,
  type MobileThemeAppearance,
  type MobileThemeVariables,
} from "./mobileTheme";
import {
  auditTextContrast,
  enforceTextContrast,
  failingTextContrast,
  TEXT_CONTRAST_MINIMUM,
} from "./themeContrastAudit";
import {
  readableWindowGlassPlan,
  resolveReadableTheme,
  resolveWindowGlassPlan,
  type WindowGlassMode,
} from "./windowGlass";

const APPEARANCES: ReadonlyArray<MobileThemeAppearance> = ["light", "dark"];

// Real desktop schemes as the dotfiles hook sends them: the owner's dark Noctalia scheme from a
// pywal wallpaper, and a light pywal scheme with a low-contrast accent.
const DESKTOP_SCHEMES = {
  "noctalia-dark": {
    mSurface: "#181f23",
    mOnSurface: "#d1deda",
    mOnSurfaceVariant: "#d1deda",
    mPrimary: "#c8be72",
    mSecondary: "#c8be72",
    mTertiary: "#d1deda",
    mSurfaceVariant: "#282d2a",
    mOutline: "#494c39",
    mError: "#e75e78",
  },
  "pywal-light": { surface: "f2efe9", onSurface: "2b2b2b", primary: "e0b050" },
};

function cases(): ReadonlyArray<readonly [string, MobileThemeVariables]> {
  const out: Array<readonly [string, MobileThemeVariables]> = [];
  for (const theme of [DEFAULT_MOBILE_THEME_ID, ...BUILT_IN_THEMES.map((entry) => entry.id)]) {
    for (const appearance of APPEARANCES) {
      out.push([
        `${theme}/${appearance}`,
        getMobileThemeVariables(theme as typeof DEFAULT_MOBILE_THEME_ID, appearance),
      ]);
    }
  }
  for (const [name, raw] of Object.entries(DESKTOP_SCHEMES)) {
    const palette = desktopColorsToPalette(parseDesktopColors(raw)!);
    const appearance = paletteAppearance(palette);
    out.push([
      `desktop:${name}`,
      materialYouPaletteToMobileThemeVariables(
        palette,
        appearance,
        getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, appearance),
      ),
    ]);
  }
  return out;
}

const GLASS: ReadonlyArray<readonly [WindowGlassMode, boolean]> = [
  ["off", false],
  ["clear", false],
  ["frosted", false],
  ["frosted", true],
];

const PAINTED = cases().flatMap(([name, variables]) =>
  GLASS.map(([mode, blur]) => ({
    name: `${name} ${mode}${blur ? " (blur)" : ""}`,
    variables,
    mode,
    blur,
  })),
);

describe("text contrast as painted", () => {
  it.each(PAINTED)("$name: every text role reaches 4.5:1", ({ variables, mode, blur }) => {
    const theme = resolveReadableTheme(variables, resolveWindowGlassPlan(mode, blur));
    const failures = failingTextContrast(theme.variables, {
      glassRootColor: theme.glassRootColor,
    }).map((finding) => `${finding.text} on ${finding.background}: ${finding.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});

describe("readableWindowGlassPlan", () => {
  const dark = getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark");

  it("thickens a see-through tint until body text reads over a white wallpaper", () => {
    const asked = resolveWindowGlassPlan("clear", false)!;
    const plan = readableWindowGlassPlan(dark, asked)!;
    expect(plan.tint).toBeGreaterThan(asked.tint);
    expect(plan.tint).toBeLessThan(1);
  });

  it("never thins the tint the mode asked for", () => {
    const asked = { tint: 0.95, pane: 0.3, blurDp: 0 };
    expect(readableWindowGlassPlan(dark, asked)).toBe(asked);
    expect(readableWindowGlassPlan(dark, null)).toBeNull();
  });
});

describe("enforceTextContrast", () => {
  it("keeps colors that already read and moves only the ones that miss", () => {
    const base = getMobileThemeVariables(DEFAULT_MOBILE_THEME_ID, "dark");
    const faint = { ...base, "--color-foreground-muted": "#3a3a3a" } as MobileThemeVariables;
    const fixed = enforceTextContrast(faint);
    expect(fixed["--color-foreground"]).toBe(base["--color-foreground"]);
    expect(fixed["--color-foreground-muted"]).not.toBe("#3a3a3a");
    const muted = auditTextContrast(fixed).filter(
      (finding) => finding.text === "--color-foreground-muted",
    );
    expect(Math.min(...muted.map((finding) => finding.ratio))).toBeGreaterThanOrEqual(
      TEXT_CONTRAST_MINIMUM,
    );
  });
});

describe("paletteAppearance", () => {
  it("reads a desktop scheme's own lightness", () => {
    expect(paletteAppearance({ surface: "#181f23" })).toBe("dark");
    expect(paletteAppearance({ surface: "#f2efe9" })).toBe("light");
  });
});
