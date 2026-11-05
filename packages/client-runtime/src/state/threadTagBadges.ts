import { ThreadTag, type ThreadTagColor, type ThreadTagIcon, type ThreadTagStyle } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

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

/** Only styled tags show, in style priority order rather than assignment order. */
export function resolveThreadTagBadges(
  tags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<ThreadTagStyle>,
): ThreadTagBadges {
  if (tags === undefined || tags.length === 0 || styles.length === 0) return NO_THREAD_TAG_BADGES;
  const present = new Set(tags);
  const badges = styles
    .filter((style) => present.has(style.tag))
    .map((style): ThreadTagBadge => ({
      tag: style.displayName ?? style.tag,
      icon: style.icon ?? null,
      color: style.color ?? null,
    }));
  if (badges.length === 0) return NO_THREAD_TAG_BADGES;
  const leading = badges.find((badge) => badge.icon !== null) ?? null;
  return { leading, chips: badges.filter((badge) => badge !== leading) };
}

/** Menu ids always use assignment keys, never editable labels. */
export function threadMenuTags(
  threadTags: ReadonlyArray<string> | undefined,
  styles: ReadonlyArray<Pick<ThreadTagStyle, "tag" | "displayName">>,
): ReadonlyArray<{ readonly tag: string; readonly name: string; readonly checked: boolean }> {
  const present = new Set(threadTags ?? []);
  const styled = new Set(styles.map((style) => style.tag));
  return [
    ...styles.map((style) => ({
      tag: style.tag,
      name: style.displayName ?? style.tag,
      checked: present.has(style.tag),
    })),
    ...(threadTags ?? [])
      .filter((tag) => !styled.has(tag))
      .map((tag) => ({ tag, name: tag, checked: true })),
  ];
}

const isThreadTag = Schema.is(ThreadTag);

export function tagNameError(
  name: string,
  styles: ReadonlyArray<ThreadTagStyle>,
  key: string | null,
): string | null {
  const trimmed = name.trim();
  if (!isThreadTag(trimmed)) return "Use 1–64 characters on a single line.";
  if (styles.some((style) => style.tag !== key && (style.displayName ?? style.tag) === trimmed)) {
    return "A tag already uses this name.";
  }
  if (key === null && styles.some((style) => style.tag === trimmed)) {
    return "This tag key already exists.";
  }
  return null;
}

/** Editing the label never changes the durable key or any thread assignment. */
export function saveTagStyle(
  styles: ReadonlyArray<ThreadTagStyle>,
  original: ThreadTagStyle | null,
  name: string,
  color: ThreadTagColor,
  icon: ThreadTagIcon | null,
): ReadonlyArray<ThreadTagStyle> {
  if (tagNameError(name, styles, original?.tag ?? null)) return styles;
  const tag = original?.tag ?? name.trim();
  const next: ThreadTagStyle = {
    tag,
    displayName: name.trim(),
    color,
    ...(icon === null ? {} : { icon }),
  };
  return styles.some((style) => style.tag === tag)
    ? styles.map((style) => (style.tag === tag ? next : style))
    : [...styles, next];
}

export function moveTagStyle(
  styles: ReadonlyArray<ThreadTagStyle>,
  tag: string,
  direction: -1 | 1,
): ReadonlyArray<ThreadTagStyle> {
  const index = styles.findIndex((style) => style.tag === tag);
  const other = index + direction;
  if (index < 0 || other < 0 || other >= styles.length) return styles;
  const next = [...styles];
  const current = next[index];
  const neighbor = next[other];
  if (!current || !neighbor) return styles;
  next[index] = neighbor;
  next[other] = current;
  return next;
}
