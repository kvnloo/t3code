import { useAtomValue } from "@effect/atom-react";
import {
  resolveThreadTagBadges,
  type ThreadTagBadge,
  type ThreadTagBadges,
} from "@t3tools/client-runtime/state/thread-tag-badges";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ThreadTagColor, ThreadTagIcon } from "@t3tools/contracts";
import { memo, useMemo } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { serverEnvironment } from "../../state/server";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

/** One symbol per tag icon; Android maps each to its Tabler twin. */
export const THREAD_TAG_SYMBOLS: Record<ThreadTagIcon, AppSymbolName> = {
  flame: "flame",
  star: "star.fill",
  hand: "hand.raised",
  bolt: "bolt",
  alert: "exclamationmark.triangle",
  check: "checkmark",
  clock: "clock",
  pause: "pause",
  eye: "eye",
  rocket: "paperplane",
  bug: "ladybug",
  flask: "testtube.2",
  sparkles: "sparkles",
  brain: "brain",
  chart: "chart.bar.xaxis",
  code: "chevron.left.forwardslash.chevron.right",
  "pull-request": PullRequestGlyph.pullRequest,
  phone: "iphone",
  film: "film",
  palette: "paintbrush",
  book: "book",
  heart: "heart",
  lock: "lock",
  cloud: "cloud",
};

/** Mid-tone tints that read on both light and dark rows. */
export const THREAD_TAG_TINTS: Record<ThreadTagColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#10b981",
  teal: "#14b8a6",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  pink: "#ec4899",
  gray: "#9ca3af",
};

const MAX_ROW_CHIPS = 2;

/** A thread's tag badges, styled by its own environment's settings. */
export function useThreadTagBadges(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "source">,
): ThreadTagBadges {
  const styles = useAtomValue(serverEnvironment.threadTagStylesAtom(thread.environmentId));
  const tags = thread.source.tags;
  return useMemo(() => resolveThreadTagBadges(tags, styles), [tags, styles]);
}

export const ThreadTagLeadingSymbol = memo(function ThreadTagLeadingSymbol(props: {
  readonly badge: ThreadTagBadge;
  readonly size: number;
}) {
  const { badge } = props;
  if (badge.icon === null) return null;
  return (
    <SymbolView
      name={THREAD_TAG_SYMBOLS[badge.icon]}
      size={props.size}
      tintColor={THREAD_TAG_TINTS[badge.color ?? "gray"]}
      type="monochrome"
      weight="semibold"
      accessibilityLabel={badge.tag}
    />
  );
});

/** Chips for a thread's other styled tags; extras fold into "+N". */
export const ThreadTagChipRow = memo(function ThreadTagChipRow(props: {
  readonly badges: ThreadTagBadges;
}) {
  const { chips } = props.badges;
  if (chips.length === 0) return null;
  const hidden = chips.length - MAX_ROW_CHIPS;
  return (
    <View className="shrink-0 flex-row items-center gap-1">
      {chips.slice(0, MAX_ROW_CHIPS).map((badge) => {
        const tint = THREAD_TAG_TINTS[badge.color ?? "gray"];
        return (
          <View
            key={badge.tag}
            className="flex-row items-center gap-0.5 rounded-full px-1.5"
            style={{ backgroundColor: `${tint}26` }}
          >
            {badge.icon === null ? null : (
              <SymbolView
                name={THREAD_TAG_SYMBOLS[badge.icon]}
                size={10}
                tintColor={tint}
                type="monochrome"
              />
            )}
            <Text className="text-xs font-t3-medium" style={{ color: tint }} numberOfLines={1}>
              {badge.tag}
            </Text>
          </View>
        );
      })}
      {hidden > 0 ? <Text className="text-xs text-foreground-muted">+{hidden}</Text> : null}
    </View>
  );
});
