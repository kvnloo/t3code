import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";
import { HANDOFF_COMMAND } from "@t3tools/shared/threadHandoff";

import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { scoreProviderSkill } from "../../providerSkillSearch";

type SlashSearchItem = Extract<
  ComposerCommandItem,
  { type: "slash-command" | "provider-slash-command" | "skill" }
>;

/** T3's `/handoff`, described by why it cannot run yet when `disabledReason` is set. */
export function handoffSlashCommandItems(input: {
  readonly available: boolean;
  readonly disabledReason: string | null;
}): Array<Extract<ComposerCommandItem, { type: "slash-command" }>> {
  if (!input.available) return [];
  return [
    {
      id: `slash:${HANDOFF_COMMAND.name}`,
      type: "slash-command",
      command: HANDOFF_COMMAND.name,
      label: `/${HANDOFF_COMMAND.name}`,
      description: input.disabledReason ?? HANDOFF_COMMAND.description,
    },
  ];
}

/**
 * A provider command named like an offered T3 built-in stays listed after it, and says it is
 * the provider's when it has no description of its own.
 */
export function describeProviderCommandsShadowingBuiltIns<
  Item extends Extract<ComposerCommandItem, { type: "provider-slash-command" }>,
>(
  items: ReadonlyArray<Item>,
  builtIns: ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>,
): Item[] {
  const builtInNames = new Set(builtIns.map((item) => item.command.toLowerCase()));
  return items.map((item) =>
    builtInNames.has(item.command.name.toLowerCase()) &&
    item.command.description === undefined &&
    item.command.input?.hint === undefined
      ? { ...item, description: "The provider's own command" }
      : item,
  );
}

/** Provider commands, `/side`, `/btw` and `/handoff` work only at the message start. */
export function slashCommandItemsForPromptPosition(
  items: ReadonlyArray<SlashSearchItem>,
  isAtPromptStart: boolean,
): SlashSearchItem[] {
  if (isAtPromptStart) {
    return [...items];
  }
  return items.filter(
    (item) =>
      item.type === "skill" ||
      (item.type === "slash-command" &&
        item.command !== "side" &&
        item.command !== "btw" &&
        item.command !== "handoff"),
  );
}

function scoreSlashCommandItem(item: SlashSearchItem, query: string): number | null {
  if (item.type === "skill") {
    if (query === "skill") {
      return 0;
    }
    const skillQuery = query.startsWith("skill:") ? query.slice("skill:".length) : query;
    const skillScore = skillQuery ? scoreProviderSkill(item.skill, skillQuery) : 0;
    if (skillScore !== null) {
      return skillScore;
    }
    return "skill".startsWith(query) ? Number.MAX_SAFE_INTEGER : null;
  }

  const primaryValue =
    item.type === "slash-command" ? item.command.toLowerCase() : item.command.name.toLowerCase();
  const description = item.description.toLowerCase();

  const scores = [
    scoreQueryMatch({
      value: primaryValue,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

export function searchSlashCommandItems(
  items: ReadonlyArray<SlashSearchItem>,
  query: string,
): SlashSearchItem[] {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: SlashSearchItem;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of items) {
    const score = scoreSlashCommandItem(item, normalizedQuery);
    if (score === null) {
      continue;
    }

    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker:
          item.type === "slash-command"
            ? `0\u0000${item.command}`
            : item.type === "provider-slash-command"
              ? `1\u0000${item.command.name}\u0000${item.provider}`
              : `2\u0000${item.skill.name}\u0000${item.provider}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  return ranked.map((entry) => entry.item);
}
