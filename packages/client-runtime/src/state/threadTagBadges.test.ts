import { describe, expect, it } from "vite-plus/test";

import { NO_THREAD_TAG_BADGES, resolveThreadTagBadges, threadMenuTags, saveTagStyle, tagNameError, moveTagStyle } from "./threadTagBadges.ts";

describe("resolveThreadTagBadges", () => {
  const styles = [
    { tag: "needs-you", icon: "hand", color: "amber" },
    { tag: "focus", icon: "flame", color: "red" },
    { tag: "restart", color: "amber" },
  ] as const;

  it("leads with the highest-priority styled tag that has an icon", () => {
    const badges = resolveThreadTagBadges(["restart", "focus", "needs-you"], styles);
    expect(badges.leading).toEqual({ tag: "needs-you", icon: "hand", color: "amber" });
    expect(badges.chips.map((badge) => badge.tag)).toEqual(["focus", "restart"]);
  });

  it("shows a tag without an icon only as a chip", () => {
    const badges = resolveThreadTagBadges(["restart"], styles);
    expect(badges.leading).toBeNull();
    expect(badges.chips).toEqual([{ tag: "restart", icon: null, color: "amber" }]);
  });

  it("keeps unstyled tags invisible", () => {
    expect(resolveThreadTagBadges(["recording-hidden"], styles)).toBe(NO_THREAD_TAG_BADGES);
    expect(resolveThreadTagBadges(undefined, styles)).toBe(NO_THREAD_TAG_BADGES);
    expect(resolveThreadTagBadges(["focus"], [])).toBe(NO_THREAD_TAG_BADGES);
  });
});

describe("tag appearance editing", () => {
  const original = { tag: "focus", icon: "flame", color: "red" } as const;
  it("keeps exact assignment keys when changing display names", () => {
    const styles = saveTagStyle([original], original, "Deep work", "blue", null);
    expect(styles).toEqual([{ tag: "focus", displayName: "Deep work", color: "blue" }]);
    expect(threadMenuTags(["focus"], styles)).toEqual([{ tag: "focus", name: "Deep work", checked: true }]);
    expect(resolveThreadTagBadges(["focus"], styles).chips[0]?.tag).toBe("Deep work");
  });
  it("rejects blank, multiline, oversized and duplicate labels without modifying styles", () => {
    const styles = [original, { tag: "other", displayName: "Other" }];
    for (const name of ["", "a\nb", "x".repeat(65), "Other"]) {
      expect(tagNameError(name, styles, "focus")).not.toBeNull();
      expect(saveTagStyle(styles, original, name, "red", null)).toBe(styles);
    }
    expect(tagNameError("focus", styles, "focus")).toBeNull();
    expect(tagNameError("focus", styles, null)).not.toBeNull();
  });
  it("moves appearance priority without modifying assignments or mutating input", () => {
    const styles = [original, { tag: "other" }];
    expect(moveTagStyle(styles, "focus", 1).map((style) => style.tag)).toEqual(["other", "focus"]);
    expect(styles[0]).toBe(original);
    expect(moveTagStyle(styles, "focus", -1)).toBe(styles);
  });
});

describe("threadMenuTags", () => {
  it("offers every styled tag, then unstyled tags the thread already has", () => {
    expect(threadMenuTags(["private", "focus"], [{ tag: "needs-you" }, { tag: "focus" }])).toEqual([
      { tag: "needs-you", name: "needs-you", checked: false },
      { tag: "focus", name: "focus", checked: true },
      { tag: "private", name: "private", checked: true },
    ]);
  });
});
