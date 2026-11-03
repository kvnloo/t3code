import { describe, expect, it } from "vite-plus/test";

import defaultThemeVariables from "../../generated-uniwind-default-theme-variables.json";
import type { MobileThemeVariables } from "./mobileTheme";
import { applyWindowGlass, normalizeWindowGlassMode, resolveWindowGlassPlan } from "./windowGlass";

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
    const alpha = (color: string) => Number(/,\s*([\d.]+)\)$/.exec(color)?.[1]);
    expect(alpha(glass["--color-screen"])).toBe(0.5);
    expect(alpha(glass["--color-thread-canvas"])).toBe(0.5);
    expect(alpha(glass["--color-card"])).toBeCloseTo(0.7);
    // Text keeps its theme color.
    expect(glass["--color-foreground"]).toBe(dark["--color-foreground"]);
  });
});
