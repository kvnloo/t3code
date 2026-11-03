import type { OrchestrationV2Run } from "@t3tools/contracts";

/**
 * `/handoff [focus]` forks the thread at its latest finished reply into a new top-level thread and
 * opens it, sending the focus text there as its first message. Web and mobile composers share
 * this command; it is a T3 built-in, listed before any provider command with the same name.
 */
export const HANDOFF_COMMAND = {
  name: "handoff",
  description: "Continue in a new thread that keeps this conversation",
} as const;

/** `/handoff [focus]` as the whole message. */
export function parseHandoffCommand(text: string): { readonly focus: string } | null {
  const match = /^\/handoff(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return match ? { focus: match[1]?.trim() ?? "" } : null;
}

export function handoffThreadTitle(sourceTitle: string): string {
  const title = sourceTitle.trim();
  return `${title.length > 0 ? title : "Untitled thread"} (handoff)`;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/**
 * Why the thread cannot be handed off yet, or null when it can. The new thread starts from the
 * latest finished reply, so a handoff waits for the first one and for the running turn to end.
 */
export function threadHandoffDisabledReason(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "status" | "checkpointId">>,
): string | null {
  if (runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) {
    return "Wait for the current turn to finish, or stop it, before handing off.";
  }
  if (!runs.some((run) => run.status === "completed" && run.checkpointId !== null)) {
    return "Hand off after the first reply finishes.";
  }
  return null;
}

/**
 * The text `/handoff` sends on, or null when the message is not T3's handoff: either it is not a
 * `/handoff` message, or the user picked the provider's own `/handoff` from the menu, which then
 * goes to the provider as typed.
 */
export function resolveHandoffSend(input: {
  readonly text: string;
  readonly pickedProviderCommand: string | null;
}): { readonly focus: string } | null {
  if (input.pickedProviderCommand?.toLowerCase() === HANDOFF_COMMAND.name) return null;
  return parseHandoffCommand(input.text);
}

/**
 * The provider command the user picked from the menu, while the draft still starts with it. A
 * provider command that shares a name with a T3 built-in reaches the provider only this way.
 */
export function pickedProviderCommandForDraft(input: {
  readonly picked: { readonly ownerKey: string | null; readonly name: string } | null;
  readonly ownerKey: string | null;
  readonly draft: string;
}): string | null {
  const { picked } = input;
  if (picked === null || picked.ownerKey !== input.ownerKey) return null;
  const prefix = `/${picked.name.toLowerCase()}`;
  const draft = input.draft.trimStart().toLowerCase();
  return draft === prefix || draft.startsWith(`${prefix} `) || draft.startsWith(`${prefix}\n`)
    ? picked.name
    : null;
}
