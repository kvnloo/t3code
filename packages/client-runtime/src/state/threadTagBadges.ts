import type { ThreadTagColor, ThreadTagIcon, ThreadTagStyle } from "@t3tools/contracts";

export interface ThreadTagBadge {
  readonly tag: string;
  readonly icon: ThreadTagIcon | null;
  readonly color: ThreadTagColor | null;
}

export interface ThreadTagBadges {
  /** Shown in place of the project icon: the highest-priority styled tag with an icon. */
  readonly leading: ThreadTagBadge | null;
  /** Other styled tags, in priority order, shown as chips after the title. */
  readonly chips: ReadonlyArray<ThreadTagBadge>;
}

export const NO_THREAD_TAG_BADGES: ThreadTagBadges = { leading: null, chips: [] };

/**
 * How a thread's tags look in a thread list. Only tags with a style show, ordered by the
 * styles list rather than the order they were added, so priority stays the user's choice.
 */
export function resolveThreadTagBadges(
  tags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<ThreadTagStyle>,
): ThreadTagBadges {
  if (tags === undefined || tags.length === 0 || styles.length === 0) return NO_THREAD_TAG_BADGES;
  const present = new Set(tags);
  const badges = styles
    .filter((style) => present.has(style.tag))
    .map((style): ThreadTagBadge => ({
      tag: style.tag,
      icon: style.icon ?? null,
      color: style.color ?? null,
    }));
  if (badges.length === 0) return NO_THREAD_TAG_BADGES;
  const leading = badges.find((badge) => badge.icon !== null) ?? null;
  return { leading, chips: badges.filter((badge) => badge !== leading) };
}

/** Tags a thread's menu offers to toggle: every styled tag, then unstyled ones it has. */
export function threadMenuTags(
  threadTags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<{ readonly tag: string }>,
): ReadonlyArray<{ readonly tag: string; readonly checked: boolean }> {
  const present = new Set(threadTags ?? []);
  const styled = new Set(styles.map((style) => style.tag));
  return [
    ...styles.map((style) => ({ tag: style.tag, checked: present.has(style.tag) })),
    ...(threadTags ?? []).filter((tag) => !styled.has(tag)).map((tag) => ({ tag, checked: true })),
  ];
}
