import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

/**
 * Experimental group-commit window for plain provider events, in milliseconds (PoH 04).
 * `T3CODE_EXPERIMENTAL_COMMIT_WINDOW_MS` unset, invalid or 0 keeps one transaction per event.
 * Read once by the EventSink and RunExecutionService layers.
 */
export const experimentalCommitWindowMs = (): number => {
  const raw = process.env.T3CODE_EXPERIMENTAL_COMMIT_WINDOW_MS?.trim();
  if (raw === undefined || raw === "") return 0;
  const ms = Number(raw);
  return Number.isInteger(ms) && ms > 0 ? Math.min(ms, 1000) : 0;
};

/**
 * Provider events whose commit may wait for the window: their normalization reads nothing that a
 * pending, same-window event could change, except the entity named by `deferredEntityKey`.
 */
export const isDeferrableProviderEvent = (event: ProviderAdapter.ProviderAdapterV2Event) =>
  event.type === "node.updated" ||
  event.type === "message.updated" ||
  event.type === "turn_item.updated" ||
  event.type === "plan.updated";

/**
 * The stored row this event's normalization compares against. A pending event for the same key
 * must commit first, so the comparison sees it.
 */
export const deferredEntityKey = (
  event: ProviderAdapter.ProviderAdapterV2Event,
): string | undefined => {
  switch (event.type) {
    case "node.updated":
      return `node:${event.node.id}`;
    case "plan.updated":
      return `plan:${event.plan.id}`;
    default:
      return undefined;
  }
};
