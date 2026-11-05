import { describe, expect, it } from "vite-plus/test";

import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import type { MobileThemeVariables } from "./mobileTheme";
import {
  applyWindowGlass,
  colorWithAlphaHex,
  normalizeWindowGlassMode,
  resolveWindowGlassPlan,
  windowGlassRootColor,
} from "./windowGlass";

const dark = (defaultThemeVariables as Record<string, MobileThemeVariables>).dark!;

describe("resolveWindowGlassPlan", () => {
  it("is off unless asked for", () => {
    expect(resolveWindowGlassPlan("off", true)).toBeNull();
    expect(normalizeWindowGlassMode(undefined)).toBe("off");
    expect(normalizeWindowGlassMode("liquid")).toBe("off");
  });

  it("blurs only when the device allows it, and deepens the tint otherwise", () => {
    const blurred = resolveWindowGlassPlan("frosted", true)!;
    const unblurred = resolveWindowGlassPlan("frosted", false)!;
    expect(blurred.blurDp).toBeGreaterThan(0);
    expect(unblurred.blurDp).toBe(0);
    expect(unblurred.tint).toBeGreaterThan(blurred.tint);
  });
});

describe("applyWindowGlass", () => {
  it("leaves the theme untouched when off", () => {
    expect(applyWindowGlass(dark, null)).toBe(dark);
  });

  it("clears the Settings palette for either glass mode without mutating solid colors", () => {
    for (const variables of Object.values(defaultThemeVariables) as MobileThemeVariables[]) {
      const originalSheet = variables["--color-sheet-solid"];
      for (const mode of ["clear", "frosted"] as const) {
        const glass = applyWindowGlass(variables, resolveWindowGlassPlan(mode, false));
        expect(glass["--color-sheet-solid"]).toMatch(/^#[\da-f]{6}00$/i);
        expect(variables["--color-sheet-solid"]).toBe(originalSheet);
        expect(applyWindowGlass(variables, resolveWindowGlassPlan("off", false))).toBe(variables);
      }
    }
  });

  it("clears stacked full-screen backgrounds and paints the tint once at the root", () => {
    const plan = { tint: 0.5, pane: 0.25, blurDp: 0 };
    const glass = applyWindowGlass(dark, plan);
    const alpha = (color: string) => Number.parseInt(color.slice(7, 9), 16) / 255;
    expect(alpha(glass["--color-screen"])).toBe(0);
    expect(alpha(glass["--color-header"])).toBe(0);
    expect(alpha(glass["--color-sheet"])).toBe(0);
    // ScreenContent uses this background for Android Settings pages.
    expect(alpha(glass["--color-sheet-solid"])).toBe(0);
    expect(alpha(glass["--color-thread-canvas"])).toBeCloseTo(0.25, 2);
    expect(alpha(glass["--color-card"])).toBeCloseTo(0.25, 2);
    expect(windowGlassRootColor(dark, plan)).toBe("#0a0a0a80");
    expect(windowGlassRootColor(dark, null)).toBeUndefined();
    // Text keeps its theme color.
    expect(glass["--color-foreground"]).toBe(dark["--color-foreground"]);
  });
});

describe("colorWithAlphaHex", () => {
  it("emits #RRGGBBAA from hex, rgba and oklch inputs", () => {
    expect(colorWithAlphaHex("#181f23", 1)).toBe("#181f23ff");
    expect(colorWithAlphaHex("#181f23cc", 0.5)).toBe("#181f2380");
    expect(colorWithAlphaHex("rgba(10, 10, 10, 0.97)", 0.5)).toBe("#0a0a0a80");
    expect(colorWithAlphaHex("oklch(0.2 0 0)", 0.5)).toMatch(/^#[\da-f]{6}80$/);
  });
});
