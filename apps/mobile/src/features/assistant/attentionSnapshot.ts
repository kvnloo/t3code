/**
 * A read-only attention queue projected from the mobile app's already-visible
 * thread shells. This cannot fetch, authorize, or mutate a thread.
 *
 * Count only live, connected environments. Cached/offline shells are useful to
 * the regular T3 UI, but must not be described as current approvals or work.
 */
export interface AssistantAttentionEnvironment {
  readonly environmentId: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly shellLive: boolean;
}

export interface AssistantAttentionFacts {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly needsApproval: boolean;
  readonly needsAnswer: boolean;
  readonly needsPlanReview: boolean;
  readonly failed: boolean;
  readonly working: boolean;
}

export type AssistantAttentionKind =
  | "approval"
  | "question"
  | "plan"
  | "failed"
  | "working";

export interface AssistantAttentionItem {
  readonly environmentId: string;
  readonly environmentLabel: string;
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly kind: AssistantAttentionKind;
}

export interface AssistantAttentionSnapshot {
  readonly items: ReadonlyArray<AssistantAttentionItem>;
  readonly counts: Readonly<Record<AssistantAttentionKind, number>>;
  readonly liveEnvironmentCount: number;
  readonly unavailableEnvironments: ReadonlyArray<string>;
}

export type AssistantAttentionFilter = "all" | "needs-me" | "approvals" | "working";

/** Exact read-only filtering; approvals must never include other blockers. */
export function filterAssistantAttentionItems(
  items: ReadonlyArray<AssistantAttentionItem>,
  filter: AssistantAttentionFilter,
): ReadonlyArray<AssistantAttentionItem> {
  if (filter === "all") return items;
  if (filter === "approvals") return items.filter((item) => item.kind === "approval");
  if (filter === "working") return items.filter((item) => item.kind === "working");
  return items.filter((item) => item.kind !== "working");
}

const PRIORITY: Readonly<Record<AssistantAttentionKind, number>> = {
  approval: 0,
  question: 1,
  plan: 2,
  failed: 3,
  working: 4,
};

function kindFor(thread: AssistantAttentionFacts): AssistantAttentionKind | null {
  if (thread.needsApproval) return "approval";
  if (thread.needsAnswer) return "question";
  if (thread.needsPlanReview && !thread.working) return "plan";
  if (thread.working) return "working";
  if (thread.failed) return "failed";
  return null;
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function buildAssistantAttentionSnapshot(
  environments: ReadonlyArray<AssistantAttentionEnvironment>,
  threads: ReadonlyArray<AssistantAttentionFacts>,
): AssistantAttentionSnapshot {
  const live = new Map<string, string>();
  const unavailable: string[] = [];
  for (const environment of environments) {
    if (environment.enabled && environment.connected && environment.shellLive) {
      live.set(environment.environmentId, environment.label);
    } else {
      unavailable.push(environment.label);
    }
  }

  const items: AssistantAttentionItem[] = [];
  const seen = new Set<string>();
  const counts: Record<AssistantAttentionKind, number> = {
    approval: 0,
    question: 0,
    plan: 0,
    failed: 0,
    working: 0,
  };
  for (const thread of threads) {
    const environmentLabel = live.get(thread.environmentId);
    if (environmentLabel === undefined) continue;
    // Duplicate projection rows must not inflate counts or produce two targets.
    const key = JSON.stringify([thread.environmentId, thread.threadId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = kindFor(thread);
    if (kind === null) continue;
    counts[kind]++;
    items.push({
      environmentId: thread.environmentId,
      environmentLabel,
      threadId: thread.threadId,
      title: thread.title,
      updatedAt: thread.updatedAt,
      kind,
    });
  }
  items.sort(
    (left, right) =>
      PRIORITY[left.kind] - PRIORITY[right.kind] ||
      timestamp(right.updatedAt) - timestamp(left.updatedAt) ||
      left.environmentLabel.localeCompare(right.environmentLabel) ||
      left.threadId.localeCompare(right.threadId),
  );
  return {
    items,
    counts,
    liveEnvironmentCount: live.size,
    unavailableEnvironments: unavailable,
  };
}
