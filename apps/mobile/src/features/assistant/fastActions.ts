/**
 * Read-only, bounded commands for a future app-level assistant.
 *
 * No device, RPC, or provider action happens here. The caller must resolve
 * targets from its authorized, current projection and dispatch through T3's
 * existing navigation/permission paths. Jev may choose only an allowlisted
 * navigation destination; it cannot grant itself thread access or write scope.
 */
export type AssistantDestination = "chats" | "pulls" | "environments" | "usage";

export type AssistantFastAction =
  | { readonly kind: "navigate"; readonly destination: AssistantDestination }
  | { readonly kind: "inspect"; readonly queue: "approvals" | "needs-me" | "working" }
  | { readonly kind: "find-thread"; readonly title: string };

export type AssistantFastResolution =
  | { readonly kind: "action"; readonly source: "rule" | "jev"; readonly action: AssistantFastAction }
  | { readonly kind: "agent"; readonly reason: "unrecognized" | "too-long" | "low-confidence" };

export interface VisibleAssistantThread {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
}

export const ASSISTANT_JEV_MIN_CONFIDENCE = 0.82;

const DESTINATIONS: Readonly<Record<string, AssistantDestination>> = {
  "chats": "chats",
  "my chats": "chats",
  "threads": "chats",
  "my threads": "chats",
  "pull requests": "pulls",
  "prs": "pulls",
  "pulls": "pulls",
  "environments": "environments",
  "connections": "environments",
  "usage": "usage",
  "usage limits": "usage",
};

const DESTINATION_VALUES: ReadonlyArray<AssistantDestination> = [
  "chats",
  "pulls",
  "environments",
  "usage",
];

function canonical(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
}

/** Only exact low-risk phrases are admitted without a model. */
export function resolveAssistantFastAction(utterance: string): AssistantFastResolution {
  const phrase = canonical(utterance);
  if (phrase.length > 160) return { kind: "agent", reason: "too-long" };
  if (phrase.length === 0) return { kind: "agent", reason: "unrecognized" };

  const destinationPhrase = phrase.replace(/^(?:show|open|go to|take me to) (?:the )?/, "");
  const destination = DESTINATIONS[destinationPhrase];
  if (destination !== undefined) {
    return { kind: "action", source: "rule", action: { kind: "navigate", destination } };
  }

  if (["show approvals", "what needs my approval"].includes(phrase)) {
    return { kind: "action", source: "rule", action: { kind: "inspect", queue: "approvals" } };
  }
  if (["what's waiting on me", "what needs my attention", "show what needs me"].includes(phrase)) {
    return { kind: "action", source: "rule", action: { kind: "inspect", queue: "needs-me" } };
  }
  if (["show working agents", "who is working", "what's running"].includes(phrase)) {
    return { kind: "action", source: "rule", action: { kind: "inspect", queue: "working" } };
  }

  const thread = /^(?:open|find|switch to) (?:the )?thread (.+)$/.exec(phrase);
  if (thread?.[1]) {
    return { kind: "action", source: "rule", action: { kind: "find-thread", title: thread[1] } };
  }
  return { kind: "agent", reason: "unrecognized" };
}

/**
 * Jev is an optional classifier, not an executor. An unfamiliar utterance can
 * only be converted to navigation, with a confidence floor. All reads, writes,
 * sends, approvals and interrupts stay on the normal authorized T3 path.
 */
export function admitAssistantJevNavigation(
  utterance: string,
  destination: unknown,
  confidence: number,
): AssistantFastResolution {
  const rule = resolveAssistantFastAction(utterance);
  if (rule.kind === "action" || rule.reason === "too-long") return rule;
  // A high-confidence label is not evidence that the user wanted to
  // navigate. Never reinterpret a write, stop or approval request as UI motion.
  const navigationCue = /^(?:open|show|go to|take me to|navigate to|bring up|switch to|jump to)\b/;
  if (
    !navigationCue.test(canonical(utterance)) ||
    !Number.isFinite(confidence) ||
    confidence < ASSISTANT_JEV_MIN_CONFIDENCE ||
    !DESTINATION_VALUES.some((value) => value === destination)
  ) {
    return { kind: "agent", reason: "low-confidence" };
  }
  return {
    kind: "action",
    source: "jev",
    action: { kind: "navigate", destination: destination as AssistantDestination },
  };
}

/**
 * Resolve an explicitly named thread only among currently visible,
 * permission-filtered shells. Duplicate names across projects or environments
 * must not silently select a target.
 */
export function findVisibleAssistantThreadMatches(
  requestedTitle: string,
  visibleThreads: ReadonlyArray<VisibleAssistantThread>,
): ReadonlyArray<VisibleAssistantThread> {
  const title = canonical(requestedTitle);
  if (!title) return [];
  return visibleThreads.filter((thread) => canonical(thread.title) === title);
}

export function findUniqueVisibleAssistantThread(
  requestedTitle: string,
  visibleThreads: ReadonlyArray<VisibleAssistantThread>,
): VisibleAssistantThread | null {
  const matches = findVisibleAssistantThreadMatches(requestedTitle, visibleThreads);
  return matches.length === 1 ? matches[0]! : null;
}
