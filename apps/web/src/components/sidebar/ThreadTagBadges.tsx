import { useAtomValue } from "@effect/atom-react";
import {
  resolveThreadTagBadges,
  type ThreadTagBadge,
  type ThreadTagBadges,
} from "@t3tools/client-runtime/state/thread-tag-badges";
import type { ThreadTagColor, ThreadTagIcon } from "@t3tools/contracts";
import {
  BookOpenIcon,
  BrainIcon,
  BugIcon,
  ChartColumnIcon,
  CheckIcon,
  ClockIcon,
  CloudIcon,
  CodeIcon,
  EyeIcon,
  FilmIcon,
  FlameIcon,
  FlaskConicalIcon,
  HandIcon,
  HeartIcon,
  LockIcon,
  type LucideIcon,
  PaletteIcon,
  PauseIcon,
  RocketIcon,
  SmartphoneIcon,
  SparklesIcon,
  StarIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import type { SidebarThreadSummary } from "~/types";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";

/** A thread's tag badges, styled by its own environment's settings. */
export function useThreadTagBadges(
  thread: Pick<SidebarThreadSummary, "environmentId" | "source">,
): ThreadTagBadges {
  const styles = useAtomValue(serverEnvironment.threadTagStylesAtom(thread.environmentId));
  return resolveThreadTagBadges(thread.source.tags, styles);
}

/** Tag names for a row's accessible label, which hides the badges themselves. */
export function threadTagAccessibleTitle(title: string, badges: ThreadTagBadges): string {
  const tags = [badges.leading, ...badges.chips].flatMap((badge) =>
    badge === null ? [] : [badge.tag],
  );
  return tags.length === 0 ? title : `${title}, tagged ${tags.join(", ")}`;
}

export const THREAD_TAG_ICON_COMPONENTS: Record<ThreadTagIcon, LucideIcon> = {
  flame: FlameIcon,
  star: StarIcon,
  hand: HandIcon,
  bolt: ZapIcon,
  alert: TriangleAlertIcon,
  check: CheckIcon,
  clock: ClockIcon,
  pause: PauseIcon,
  eye: EyeIcon,
  rocket: RocketIcon,
  bug: BugIcon,
  flask: FlaskConicalIcon,
  sparkles: SparklesIcon,
  brain: BrainIcon,
  chart: ChartColumnIcon,
  code: CodeIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  phone: SmartphoneIcon,
  film: FilmIcon,
  palette: PaletteIcon,
  book: BookOpenIcon,
  heart: HeartIcon,
  lock: LockIcon,
  cloud: CloudIcon,
};

/** Text tint per tag color, readable on light and dark sidebars. */
export const THREAD_TAG_TEXT_CLASS: Record<ThreadTagColor, string> = {
  red: "text-red-600 dark:text-red-400",
  orange: "text-orange-600 dark:text-orange-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-300",
  pink: "text-pink-600 dark:text-pink-400",
  gray: "text-muted-foreground",
};

const THREAD_TAG_CHIP_CLASS: Record<ThreadTagColor, string> = {
  red: "bg-red-500/12",
  orange: "bg-orange-500/12",
  amber: "bg-amber-500/14",
  green: "bg-emerald-500/12",
  teal: "bg-teal-500/12",
  blue: "bg-blue-500/12",
  violet: "bg-violet-500/12",
  pink: "bg-pink-500/12",
  gray: "bg-muted",
};

/** Most chips a row shows before it folds the rest into "+N". */
const MAX_ROW_CHIPS = 2;

export function ThreadTagIconGlyph(props: {
  readonly icon: ThreadTagIcon;
  readonly color: ThreadTagColor | null;
  readonly className?: string | undefined;
}) {
  const Icon = THREAD_TAG_ICON_COMPONENTS[props.icon];
  return (
    <Icon
      aria-hidden
      className={cn(
        "shrink-0",
        props.color === null ? "text-muted-foreground" : THREAD_TAG_TEXT_CLASS[props.color],
        props.className,
      )}
    />
  );
}

/** The leading icon for a styled thread, in place of its project icon. */
export function ThreadTagLeadingIcon(props: {
  readonly badge: ThreadTagBadge;
  readonly className?: string | undefined;
}) {
  const { badge } = props;
  if (badge.icon === null) return null;
  return (
    <span
      role="img"
      aria-label={badge.tag}
      data-testid="thread-tag-leading-icon"
      className="inline-flex shrink-0 items-center justify-center"
    >
      <ThreadTagIconGlyph icon={badge.icon} color={badge.color} className={props.className} />
    </span>
  );
}

export function ThreadTagChip(props: { readonly badge: ThreadTagBadge }) {
  const { badge } = props;
  const color = badge.color ?? "gray";
  return (
    <span
      data-testid="thread-tag-chip"
      className={cn(
        "inline-flex h-4 max-w-24 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-2xs font-medium",
        THREAD_TAG_CHIP_CLASS[color],
        THREAD_TAG_TEXT_CLASS[color],
      )}
    >
      {badge.icon === null ? null : (
        <ThreadTagIconGlyph icon={badge.icon} color={color} className="size-2.5" />
      )}
      <span className="truncate">{badge.tag}</span>
    </span>
  );
}

/** Chips after a thread title. Extra tags fold into a count. */
export function ThreadTagChips(props: { readonly badges: ThreadTagBadges }) {
  const { chips } = props.badges;
  if (chips.length === 0) return null;
  const shown = chips.slice(0, MAX_ROW_CHIPS);
  const hiddenCount = chips.length - shown.length;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {shown.map((badge) => (
        <ThreadTagChip key={badge.tag} badge={badge} />
      ))}
      {hiddenCount > 0 ? (
        <span className="text-2xs text-muted-foreground tabular-nums">+{hiddenCount}</span>
      ) : null}
    </span>
  );
}
