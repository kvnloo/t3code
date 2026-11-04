import type { EnvironmentThreadShell } from "./models.ts";
import { toSortableTimestamp } from "./threadSort.ts";

/**
 * Attention priority for thread lists: tier 1 (blocked on the user) to 4 (nothing needed), and a
 * score of tier base (400..100) plus up to 99 points for need, wait, focus, habit and stakes.
 * Clock-injected via `nowMs`; only the tier 1-2 wait and the focus fade move with time.
 */
export type ThreadPriorityTier = 1 | 2 | 3 | 4;

export interface ThreadPriority {
  readonly tier: ThreadPriorityTier;
  readonly score: number;
  /** Plain-language signals behind the score, strongest first, for a tooltip or label. */
  readonly reasons: readonly string[];
}

export const THREAD_PRIORITY_TIER_LABELS: Record<ThreadPriorityTier, string> = {
  1: "Needs you",
  2: "Review",
  3: "In progress",
  4: "Quiet",
};

export type ThreadPriorityInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "latestRun"
  | "runtime"
  | "latestUserMessageAt"
  | "goal"
  | "pullRequests"
> &
  Partial<
    Pick<
      EnvironmentThreadShell,
      | "pendingSubagentRequest"
      | "pendingGuestMessageCount"
      | "pendingBackgroundTasks"
      | "blockedOnThreadWait"
      | "latestUserAuthoredMessageAt"
      | "lastVisitedAt"
      | "opens"
    >
  >;

const TIER_BASE: Record<ThreadPriorityTier, number> = { 1: 400, 2: 300, 3: 200, 4: 100 };
const MAX_BONUS = 99;
const MINUTE_MS = 60_000;
const WAIT_CAP_MINUTES = 8 * 60;
const FOCUS_WINDOW_MS = 24 * 60 * MINUTE_MS;

const ACTIVE_RUNTIME_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

interface Need {
  readonly tier: ThreadPriorityTier;
  readonly points: number;
  readonly reason: string | null;
}

function parsedAfter(laterIso: string | null | undefined, earlierIso: string | null | undefined) {
  const later = toSortableTimestamp(laterIso ?? undefined);
  if (later === null) return false;
  const earlier = toSortableTimestamp(earlierIso ?? undefined);
  return earlier === null || later > earlier;
}

function pullRequestNeed(thread: ThreadPriorityInput): string | null {
  for (const link of thread.pullRequests) {
    const snapshot = link.snapshot;
    if (snapshot === null || snapshot.state !== "open") continue;
    if (snapshot.checksState === "failing") return "PR checks failing";
    if (snapshot.reviewDecision === "changes-requested") return "PR changes requested";
    if (snapshot.mergeability === "conflicting") return "PR has conflicts";
  }
  return null;
}

function resolveNeed(thread: ThreadPriorityInput): Need {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return { tier: 1, points: 30, reason: "Pending approval" };
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return { tier: 1, points: 25, reason: "Awaiting your answer" };
  }
  if ((thread.pendingGuestMessageCount ?? 0) > 0) {
    return { tier: 1, points: 15, reason: "Guest request" };
  }

  const runtimeStatus = thread.runtime?.status;
  const working =
    (runtimeStatus !== undefined && ACTIVE_RUNTIME_STATUSES.has(runtimeStatus)) ||
    (thread.pendingBackgroundTasks?.length ?? 0) > 0;
  if (working) {
    return {
      tier: 3,
      points: 0,
      reason: thread.blockedOnThreadWait === true ? "Waiting on other work" : "Working",
    };
  }

  const run = thread.latestRun;
  // A failure the user has not opened since counts even on a thread never opened.
  if (run?.status === "failed" && parsedAfter(run.completedAt, thread.lastVisitedAt ?? null)) {
    return thread.runtime?.lastErrorClass === "usage_limit"
      ? { tier: 2, points: 5, reason: "Hit a usage limit" }
      : { tier: 2, points: 30, reason: "Failed" };
  }
  const prNeed = pullRequestNeed(thread);
  if (prNeed !== null) return { tier: 2, points: 25, reason: prNeed };
  if (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) {
    return { tier: 2, points: 20, reason: "Plan ready" };
  }
  // Matches the sidebar's unread dot: only servers that track visits can say "unseen".
  if (thread.lastVisitedAt && parsedAfter(run?.completedAt, thread.lastVisitedAt)) {
    return { tier: 2, points: 15, reason: "Finished, not yet read" };
  }
  return { tier: 4, points: 0, reason: null };
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.floor(minutes))}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

export function scoreThreadPriority(thread: ThreadPriorityInput, nowMs: number): ThreadPriority {
  const need = resolveNeed(thread);
  const reasons: string[] = need.reason === null ? [] : [need.reason];
  let bonus = need.points;

  if (need.tier <= 2) {
    const returnedAt = toSortableTimestamp(thread.latestRun?.completedAt ?? undefined);
    if (returnedAt !== null && nowMs > returnedAt) {
      const minutes = (nowMs - returnedAt) / MINUTE_MS;
      const capped = Math.min(minutes, WAIT_CAP_MINUTES);
      bonus += Math.round((30 * Math.log2(1 + capped)) / Math.log2(1 + WAIT_CAP_MINUTES));
      if (minutes >= 1) reasons.push(`Waiting ${formatWait(minutes)}`);
    }
  }

  const lastWrote = toSortableTimestamp(
    thread.latestUserAuthoredMessageAt ?? thread.latestUserMessageAt ?? undefined,
  );
  if (lastWrote !== null) {
    const sinceMs = Math.max(0, nowMs - lastWrote);
    if (sinceMs < FOCUS_WINDOW_MS) {
      const focus = Math.round(20 * (1 - sinceMs / FOCUS_WINDOW_MS));
      bonus += focus;
      if (focus >= 10) reasons.push("You were just here");
    }
  }

  const openScore = thread.opens?.score ?? 0;
  if (openScore > 0) {
    const habit = Math.min(10, Math.round(3 * Math.log2(1 + openScore)));
    bonus += habit;
    if (habit >= 6) reasons.push("Opened often");
  }

  const hasOpenPullRequest = thread.pullRequests.some((link) => link.snapshot?.state === "open");
  if (hasOpenPullRequest) {
    bonus += 5;
    if (!reasons.some((reason) => reason.startsWith("PR "))) reasons.push("Open PR");
  }
  if (thread.goal?.status === "active") {
    bonus += 5;
    reasons.push("Active goal");
  }

  return {
    tier: need.tier,
    score: TIER_BASE[need.tier] + Math.min(MAX_BONUS, bonus),
    reasons,
  };
}

/** Highest score first; ties fall back to thread identity so every client agrees. */
export function sortThreadsByPriority<
  T extends ThreadPriorityInput & { readonly id: string; readonly environmentId: string },
>(threads: readonly T[], nowMs: number): T[] {
  if (threads.length < 2) return [...threads];
  const scores = new Map(threads.map((thread) => [thread, scoreThreadPriority(thread, nowMs)]));
  return [...threads].sort(
    (left, right) =>
      scores.get(right)!.score - scores.get(left)!.score ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId),
  );
}

export interface GroupPriority {
  /** The most urgent tier among the group's threads. */
  readonly tier: ThreadPriorityTier;
  /** The group's best thread score. */
  readonly score: number;
  /** Threads in tiers 1-2, the ones that want the user now. */
  readonly attentionCount: number;
}

/** Rolls thread priorities up to a project or folder; null for a group with no threads. */
export function summarizeGroupPriority(priorities: Iterable<ThreadPriority>): GroupPriority | null {
  let summary: { tier: ThreadPriorityTier; score: number; attentionCount: number } | null = null;
  for (const priority of priorities) {
    const attention = priority.tier <= 2 ? 1 : 0;
    if (summary === null) {
      summary = { tier: priority.tier, score: priority.score, attentionCount: attention };
      continue;
    }
    if (priority.tier < summary.tier) summary.tier = priority.tier;
    if (priority.score > summary.score) summary.score = priority.score;
    summary.attentionCount += attention;
  }
  return summary;
}

/** Most urgent tier first, then more threads wanting the user, then the best score. */
export function compareGroupPriority(left: GroupPriority | null, right: GroupPriority | null) {
  if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0);
  return (
    left.tier - right.tier || right.attentionCount - left.attentionCount || right.score - left.score
  );
}
