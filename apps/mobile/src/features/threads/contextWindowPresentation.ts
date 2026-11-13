import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  latestProviderTurnTokenUsage,
  type ContextWindowSnapshot,
} from "@t3tools/client-runtime/context-window";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { ModelSelection } from "@t3tools/contracts";

export function deriveComposerContextWindow(
  projection: ThreadStructure | null,
  selection: ModelSelection,
): ContextWindowSnapshot | null {
  if (
    projection === null ||
    projection.thread.modelSelection.instanceId !== selection.instanceId ||
    projection.thread.modelSelection.model !== selection.model
  ) {
    return null;
  }
  const providerThread = projection.providerThreads.find(
    (thread) =>
      thread.id === projection.thread.activeProviderThreadId &&
      thread.providerInstanceId === selection.instanceId,
  );
  if (!providerThread) return null;
  const latestRun = projection.runs.findLast(
    (run) => run.providerThreadId === providerThread.id && run.startedAt !== null,
  );
  const reportedModel = providerThread.nativeMetadata?.modelSelection ?? latestRun?.modelSelection;
  if (reportedModel && reportedModel.model !== selection.model) return null;
  const usage = latestProviderTurnTokenUsage(
    projection.providerTurns.filter((turn) => turn.providerThreadId === providerThread.id),
    projection,
    providerThread,
  );
  const entries = projection.visibleTurnItems.filter(
    ({ item }) => item.providerThreadId === providerThread.id && item.status === "completed",
  );
  const snapshot = deriveLatestContextWindowSnapshot([], usage, providerThread);
  const compaction = deriveLatestContextWindowSnapshot(entries);
  // A completed compaction supersedes the preceding turn's occupancy report.
  return compaction && (!snapshot || Date.parse(compaction.updatedAt) > Date.parse(snapshot.updatedAt))
    ? compaction
    : snapshot;
}

export function contextWindowPresentation(usage: ContextWindowSnapshot | null) {
  if (usage === null || !Number.isFinite(usage.usedTokens) || usage.usedTokens < 0) {
    return {
      label: "Context unavailable",
      accessibilityLabel: "Context window usage unavailable",
      details: "This provider has not reported current context-window usage.",
    };
  }
  const used = formatContextWindowTokens(usage.usedTokens);
  const max = usage.maxTokens;
  const capacityKnown = max !== null && Number.isFinite(max) && max > 0;
  const exactUsed = usage.usedTokens.toLocaleString();
  if (!capacityKnown) {
    return {
      label: `Context ${used} / unavailable`,
      accessibilityLabel: `Context window: ${exactUsed} tokens used. Capacity and percentage unavailable`,
      details: `Used: ${exactUsed} tokens\nCapacity: unavailable\nPercentage: unavailable\n\nThe provider did not report a usable context-window capacity.`,
    };
  }
  const percentage = Math.round((usage.usedTokens / max) * 100);
  return {
    label: `Context ${used} / ${formatContextWindowTokens(max)} · ${percentage}%`,
    accessibilityLabel: `Context window: ${exactUsed} of ${max.toLocaleString()} tokens used, ${percentage} percent`,
    details: `Used: ${exactUsed} tokens\nCapacity: ${max.toLocaleString()} tokens\nUsed: ${percentage}%\nRemaining: ${Math.max(0, max - usage.usedTokens).toLocaleString()} tokens\n\nCurrent context occupancy, not cumulative billing tokens.\nReported: ${usage.updatedAt}`,
  };
}
