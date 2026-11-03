import type { AppSymbolName } from "../../components/ui/AppSymbol";

/**
 * Thread-level share and handoff actions, in the order every mobile entry point lists them: the
 * Android header overflow, the iOS header menu, and the command palette.
 */
export type ThreadShareActionId = "handoff" | "share-guest" | "stop-guest-share";

export interface ThreadShareAction {
  readonly id: ThreadShareActionId;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: AppSymbolName;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}

export function buildThreadShareActions(input: {
  readonly canOperateThread: boolean;
  /** Null when the thread can be handed off now. */
  readonly handoffDisabledReason: string | null;
  readonly canCreateGuestShare: boolean;
  readonly hasGuestShare: boolean;
}): ThreadShareAction[] {
  if (!input.canOperateThread) return [];
  const actions: ThreadShareAction[] = [
    {
      id: "handoff",
      title: "Hand off to new thread",
      subtitle: input.handoffDisabledReason ?? "Continue in a new thread with this conversation",
      icon: "arrow.triangle.branch",
      ...(input.handoffDisabledReason === null ? {} : { disabled: true }),
    },
  ];
  if (input.canCreateGuestShare) {
    actions.push({
      id: "share-guest",
      // A thread has one guest link; a new one ends the current one.
      title: input.hasGuestShare ? "New guest link" : "Share with guest",
      subtitle: input.hasGuestShare
        ? "Ends the current guest link"
        : "One guest can watch and suggest messages",
      icon: "person.badge.plus",
    });
  }
  if (input.hasGuestShare) {
    actions.push({
      id: "stop-guest-share",
      title: "Stop sharing",
      subtitle: "The guest loses access",
      icon: "person.fill.xmark",
      destructive: true,
    });
  }
  return actions;
}

const GUEST_SHARE_CREATE_FAILURES = {
  disabled:
    "Guest links are off on this machine. Turn on Settings > Labs > Guest links in T3 Code on the computer running it, then try again.",
  connect_unavailable:
    "Guest links need T3 Connect. Start T3 Connect on the computer running T3 Code, then try again.",
  thread_unavailable: "This thread cannot be shared.",
  read_failed: "Failed to read the shared thread.",
  changed: "The guest link changed while it was being created. Try again.",
} as const;

/** The message for a failed guest link, by the server's `GuestShareCreateError` reason. */
export function guestShareCreateFailureMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "GuestShareCreateError" &&
    "reason" in error &&
    typeof error.reason === "string" &&
    error.reason in GUEST_SHARE_CREATE_FAILURES
  ) {
    return GUEST_SHARE_CREATE_FAILURES[error.reason as keyof typeof GUEST_SHARE_CREATE_FAILURES];
  }
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Could not create a guest link.";
}
