import { describe, expect, it } from "vite-plus/test";

import { NO_THREAD_TAG_BADGES, resolveThreadTagBadges, threadMenuTags } from "./threadTagBadges.ts";

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

describe("threadMenuTags", () => {
  it("offers every styled tag, then unstyled tags the thread already has", () => {
    expect(threadMenuTags(["private", "focus"], [{ tag: "needs-you" }, { tag: "focus" }])).toEqual([
      { tag: "needs-you", checked: false },
      { tag: "focus", checked: true },
      { tag: "private", checked: true },
    ]);
  });
});
