import { describe, expect, it } from "vite-plus/test";

import { flattenThemeColor, MOBILE_THEME_IDS } from "../../lib/mobileTheme";
import { getMobileThemeRuntimeVariables } from "../../lib/mobileThemeVariables";
import { TEXT_CONTRAST_MINIMUM } from "../../lib/themeContrastAudit";
import {
  resolveReadableTheme,
  resolveWindowGlassPlan,
  type WindowGlassMode,
} from "../../lib/windowGlass";
import {
  androidWorkspaceNavigationColors,
  GLASS_PILL_CONTENT_GHOST_MAX,
  glassPillAlpha,
  glassPillContentGhost,
} from "./android-workspace-navigation-colors";

function luminance(hex: string) {
  const channels = hex
    .slice(1, 7)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const GLASS: ReadonlyArray<readonly [WindowGlassMode, boolean]> = [
  ["clear", false],
  ["frosted", false],
  ["frosted", true],
];

const CASES = MOBILE_THEME_IDS.flatMap((themeId) =>
  (["light", "dark"] as const).flatMap((appearance) =>
    GLASS.map(([mode, blur]) => ({
      name: `${themeId} ${appearance} ${mode}${blur ? " (blur)" : ""}`,
      themeId,
      appearance,
      mode,
      blur,
    })),
  ),
);

describe("Android floating navigation pill on window glass", () => {
  it.each(CASES)("$name: the pill is a see-through pane", ({ themeId, appearance, mode, blur }) => {
    const plan = resolveWindowGlassPlan(mode, blur)!;
    const theme = resolveReadableTheme(
      getMobileThemeRuntimeVariables(themeId, appearance, "android"),
      plan,
    );
    const rootColor = theme.glassRootColor!;
    const colors = androidWorkspaceNavigationColors(theme.variables, false, true, {
      pane: plan.pane,
      rootColor,
    });

    // Still a glass pane (8-digit hex), never thinner than the other panes.
    expect(colors.containerColor).toMatch(/^#[\da-f]{8}$/iu);
    const alpha = Number.parseInt(colors.containerColor.slice(7, 9), 16) / 255;
    expect(alpha).toBeGreaterThanOrEqual(Math.round(plan.pane * 255) / 255);

    // Where the pill can land: the root tint over black or white wallpaper, bare or over a card.
    const surfaces = ["#000000", "#ffffff"].flatMap((wallpaper) => {
      const tinted = flattenThemeColor(rootColor, wallpaper);
      return [tinted, flattenThemeColor(theme.variables["--color-grouped-card"], tinted)];
    });
    const pills = surfaces.map((surface) => flattenThemeColor(colors.containerColor, surface));
    for (const pill of pills) {
      expect(contrast(colors.unselectedColor, pill), `unselected on ${pill}`).toBeGreaterThanOrEqual(
        TEXT_CONTRAST_MINIMUM,
      );
      expect(contrast(colors.indicatorColor, pill), `indicator on ${pill}`).toBeGreaterThanOrEqual(
        1.5,
      );
    }
    expect(contrast(colors.selectedColor, colors.indicatorColor)).toBeGreaterThanOrEqual(
      TEXT_CONTRAST_MINIMUM,
    );
  });

  it.each(CASES)(
    "$name: rows scrolling under the pill don't read through it",
    ({ themeId, appearance, mode, blur }) => {
      const plan = resolveWindowGlassPlan(mode, blur)!;
      const theme = resolveReadableTheme(
        getMobileThemeRuntimeVariables(themeId, appearance, "android"),
        plan,
      );
      const glass = { pane: plan.pane, rootColor: theme.glassRootColor! };
      const colors = androidWorkspaceNavigationColors(theme.variables, false, true, glass);
      const fill = theme.variables["--color-secondary"];
      const alpha = Number.parseInt(colors.containerColor.slice(7, 9), 16) / 255;

      // Text and accents under the pill, over every backdrop it can sit on, stay a faint ghost.
      const surfaces = ["#000000", "#ffffff"].flatMap((wallpaper) => {
        const tinted = flattenThemeColor(glass.rootColor, wallpaper);
        return [tinted, flattenThemeColor(theme.variables["--color-grouped-card"], tinted)];
      });
      for (const surface of surfaces) {
        for (const role of ["--color-foreground", "--color-primary"] as const) {
          const pill = flattenThemeColor(colors.containerColor, surface);
          const ghost = flattenThemeColor(
            colors.containerColor,
            flattenThemeColor(theme.variables[role], surface),
          );
          expect(contrast(ghost, pill), `${role} under the pill on ${surface}`).toBeLessThanOrEqual(
            GLASS_PILL_CONTENT_GHOST_MAX + 0.02,
          );
        }
      }
      // And no thicker than needed: one step thinner would let the text read again.
      const chosen = glassPillAlpha(theme.variables, glass);
      expect(Math.abs(chosen - alpha)).toBeLessThan(1 / 255 + 1e-9);
      if (chosen > plan.pane) {
        expect(glassPillContentGhost(theme.variables, glass, chosen - 0.02)).toBeGreaterThan(
          GLASS_PILL_CONTENT_GHOST_MAX,
        );
      }
      expect(fill).toBeTruthy();
    },
  );

  it("keeps the solid pill opaque and unchanged without glass", () => {
    for (const themeId of MOBILE_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        const solid = androidWorkspaceNavigationColors(variables, false, true);
        expect(solid.containerColor).toMatch(/^#[\da-f]{6}$/iu);
        expect(androidWorkspaceNavigationColors(variables, false, true, undefined)).toEqual(solid);
      }
    }
  });

  it("leaves the rail and the docked bar alone in glass mode", () => {
    const plan = resolveWindowGlassPlan("frosted", true)!;
    const theme = resolveReadableTheme(
      getMobileThemeRuntimeVariables(MOBILE_THEME_IDS[0], "dark", "android"),
      plan,
    );
    const glass = { pane: plan.pane, rootColor: theme.glassRootColor! };
    for (const rail of [true, false]) {
      expect(androidWorkspaceNavigationColors(theme.variables, rail, false, glass)).toEqual(
        androidWorkspaceNavigationColors(theme.variables, rail, false),
      );
    }
  });
});
