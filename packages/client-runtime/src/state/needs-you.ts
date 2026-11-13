import type { EnvironmentThreadShell } from "./shell.ts";
import { effectiveSnoozed } from "./threadSettled.ts";
import { isThreadWorking } from "./threadInbox.ts";

export function needsYouKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return `${thread.environmentId}:${thread.id}`;
}

/** A pending approval, question or guest message must be answered before the thread can be settled. */
export function needsYouAwaitsDecision(thread: EnvironmentThreadShell) {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null ||
    thread.source.pendingRuntimeRequest !== null ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  );
}

export function needsYouReason(thread: EnvironmentThreadShell, now: string) {
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval")
    return "Approval needed";
  if (
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest === "user_input" ||
    thread.source.pendingRuntimeRequest !== null
  )
    return "Your input needed";
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return "Guest message";
  if (thread.settledOverride === "settled" || effectiveSnoozed(thread, { now })) return null;
  if (thread.runtime?.status === "failed" || thread.latestRun?.status === "failed")
    return "Run failed";
  if (isThreadWorking(thread)) return null;
  if (thread.hasActionableProposedPlan) return "Plan ready";
  if (thread.source.latestVisibleMessage?.role === "assistant") return "Ready for review";
  return null;
}

const reasonOrder = [
  "Approval needed",
  "Your input needed",
  "Guest message",
  "Run failed",
  "Plan ready",
  "Ready for review",
];

export function needsYouQueue(threads: readonly EnvironmentThreadShell[], now: string) {
  return threads
    .flatMap((thread) => {
      const reason = needsYouReason(thread, now);
      return reason === null ? [] : [{ thread, reason, key: needsYouKey(thread) }];
    })
    .sort(
      (a, b) =>
        Number(b.thread.pinnedAt !== null) - Number(a.thread.pinnedAt !== null) ||
        reasonOrder.indexOf(a.reason) - reasonOrder.indexOf(b.reason) ||
        b.thread.updatedAt.localeCompare(a.thread.updatedAt) ||
        a.key.localeCompare(b.key),
    );
}

export function nextNeedsYouKey(
  keys: readonly string[],
  selected: string | null,
  previousKeys: readonly string[],
) {
  if (selected !== null && keys.includes(selected)) return selected;
  const index = selected === null ? 0 : Math.max(0, previousKeys.indexOf(selected));
  return keys[Math.min(index, keys.length - 1)] ?? null;
}
