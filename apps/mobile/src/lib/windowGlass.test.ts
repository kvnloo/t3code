import { describe, expect, it } from "vite-plus/test";

import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import type { MobileThemeVariables } from "./mobileTheme";
import {
  applyWindowGlass,
  colorWithAlphaHex,
  normalizeWindowGlassMode,
  resolveWindowGlassPlan,
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

  it("makes full-screen backgrounds translucent and panels denser than the scene", () => {
    const glass = applyWindowGlass(dark, { tint: 0.5, blurDp: 0 });
    const alpha = (color: string) => Number.parseInt(color.slice(7, 9), 16) / 255;
    expect(glass["--color-screen"]).toBe("#0a0a0a80");
    expect(alpha(glass["--color-thread-canvas"])).toBeCloseTo(0.5, 2);
    expect(alpha(glass["--color-card"])).toBeCloseTo(0.7, 2);
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
