import { describe, expect, it } from "vite-plus/test";

import { desktopColorsToPalette, mixHex, parseDesktopColors } from "./desktopColors";
import { themeColorContrastRatio } from "./mobileTheme";

// A real Noctalia colors.json, as the dotfiles hook sends it.
const NOCTALIA = {
  mError: "#e75e78",
  mOnPrimary: "#101417",
  mOnSurface: "#d1deda",
  mOnSurfaceVariant: "#d1deda",
  mOutline: "#494c39",
  mPrimary: "#c8be72",
  mSecondary: "#c8be72",
  mShadow: "#181f23",
  mSurface: "#181f23",
  mSurfaceVariant: "#282d2a",
  mTertiary: "#d1deda",
};

describe("parseDesktopColors", () => {
  it("reads Noctalia keys", () => {
    expect(parseDesktopColors(NOCTALIA)).toMatchObject({
      surface: "#181f23",
      onSurface: "#d1deda",
      primary: "#c8be72",
      surfaceVariant: "#282d2a",
    });
  });

  it("accepts plain role names without the leading # that adb strips", () => {
    expect(
      parseDesktopColors({ surface: "181F23", onSurface: "d1deda", primary: "c8be72" }),
    ).toEqual({ surface: "#181f23", onSurface: "#d1deda", primary: "#c8be72" });
  });

  it("rejects payloads without the three seeds or with malformed colors", () => {
    expect(parseDesktopColors({ surface: "#181f23", onSurface: "#d1deda" })).toBeNull();
    expect(
      parseDesktopColors({ surface: "red", onSurface: "#d1deda", primary: "#c8be72" }),
    ).toBeNull();
    expect(parseDesktopColors("#181f23")).toBeNull();
  });
});

describe("desktopColorsToPalette", () => {
  it("keeps the desktop's own colors for the roles it defines", () => {
    const palette = desktopColorsToPalette(parseDesktopColors(NOCTALIA)!);
    expect(palette.surface).toBe("#181f23");
    expect(palette.onSurface).toBe("#d1deda");
    expect(palette.primary).toBe("#c8be72");
    expect(palette.onPrimary).toBe("#101417");
    expect(palette.surfaceContainer).toBe("#282d2a");
    expect(palette.outline).toBe("#494c39");
  });

  it("derives readable foregrounds when only the seeds are sent", () => {
    const palette = desktopColorsToPalette({
      surface: "#181f23",
      onSurface: "#d1deda",
      primary: "#c8be72",
    });
    expect(themeColorContrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(
      themeColorContrastRatio(palette.onPrimaryContainer, palette.primaryContainer),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      themeColorContrastRatio(palette.onSecondaryContainer, palette.secondaryContainer),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("mixHex", () => {
  it("mixes in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#181f23", "#d1deda", 0)).toBe("#181f23");
  });
});
