/**
 * Fork-only voice intent admission, deliberately separate from microphone,
 * provider and T3 orchestration transports.
 *
 * A caller must acquire user consent for the single selected environment
 * before routing speech or summaries to a voice provider. Only FINAL user
 * transcripts (not model-supplied tool arguments) belong here. Nothing in
 * this module sends, approves, interrupts, archives, or fetches a transcript.
 * Adapted to T3's local navigation and live shell projections; compare the
 * separate app-level voice prototype in elliptic1/t3code#15544.
 */
import {
  buildAssistantAttentionSnapshot,
  filterAssistantAttentionItems,
  type AssistantAttentionEnvironment,
  type AssistantAttentionFacts,
  type AssistantAttentionItem,
} from "./attentionSnapshot";
import {
  findVisibleAssistantThreadMatches,
  resolveAssistantFastAction,
  type AssistantDestination,
  type VisibleAssistantThread,
} from "./fastActions";

export interface AssistantVoiceProjection {
  readonly environments: ReadonlyArray<AssistantAttentionEnvironment>;
  readonly threads: ReadonlyArray<AssistantAttentionFacts>;
}

export type AssistantVoiceAdmission =
  | { readonly kind: "navigate"; readonly destination: AssistantDestination }
  | {
      readonly kind: "attention";
      readonly filter: "approvals" | "needs-me" | "working";
      readonly total: number;
      readonly items: ReadonlyArray<AssistantAttentionItem>;
    }
  | { readonly kind: "open-thread"; readonly thread: VisibleAssistantThread }
  | { readonly kind: "ambiguous"; readonly matches: number }
  | {
      readonly kind: "refused";
      readonly reason:
        | "closed"
        | "invalid-id"
        | "duplicate"
        | "session-limit"
        | "unsupported"
        | "unavailable"
        | "missing-thread";
    };

const MAX_SESSION_UTTERANCES = 256;
const MAX_RETURNED_ATTENTION_ITEMS = 8;
const UTTERANCE_ID = /^[a-zA-Z0-9_.:-]{1,96}$/;

/**
 * One gate per deliberately started voice session. The fixed environment ID
 * cannot be changed by a transcription or provider-supplied argument.
 * Recheck live/authorized projections on EVERY read. Call close on stop,
 * disconnect, app background, environment switch or microphone revocation.
 * The eventual UI target must revalidate just before navigation.
 */
export function createAssistantReadOnlyVoiceGate(config: {
  readonly environmentId: string;
  readonly getProjection: () => AssistantVoiceProjection;
  readonly signal?: AbortSignal;
}) {
  const seen = new Set<string>();
  let closed = false;
  const refused = (
    reason: Extract<AssistantVoiceAdmission, { kind: "refused" }>["reason"],
  ): AssistantVoiceAdmission => ({
    kind: "refused",
    reason,
  });

  return {
    close(): void {
      closed = true;
    },
    admitFinal(input: {
      readonly utteranceId: unknown;
      readonly transcript: unknown;
    }): AssistantVoiceAdmission {
      if (closed || config.signal?.aborted) return refused("closed");
      if (typeof input.utteranceId !== "string" || !UTTERANCE_ID.test(input.utteranceId)) {
        return refused("invalid-id");
      }
      if (seen.has(input.utteranceId)) return refused("duplicate");
      // Refuse instead of evicting old IDs, which would admit stale replays.
      if (seen.size >= MAX_SESSION_UTTERANCES) return refused("session-limit");
      seen.add(input.utteranceId);

      if (typeof input.transcript !== "string") return refused("unsupported");
      const resolved = resolveAssistantFastAction(input.transcript);
      if (resolved.kind !== "action") return refused("unsupported");
      if (resolved.action.kind === "navigate") {
        return { kind: "navigate", destination: resolved.action.destination };
      }

      let projection: AssistantVoiceProjection;
      try {
        projection = config.getProjection();
      } catch {
        return refused("unavailable");
      }
      const environment = projection.environments.find(
        (entry) => entry.environmentId === config.environmentId,
      );
      if (!environment?.enabled || !environment.connected || !environment.shellLive) {
        return refused("unavailable");
      }
      const currentThreads = projection.threads.filter(
        (thread) => thread.environmentId === config.environmentId,
      );
      if (resolved.action.kind === "inspect") {
        const snapshot = buildAssistantAttentionSnapshot([environment], currentThreads);
        const items = filterAssistantAttentionItems(snapshot.items, resolved.action.queue);
        return {
          kind: "attention",
          filter: resolved.action.queue,
          total: items.length,
          items: items.slice(0, MAX_RETURNED_ATTENTION_ITEMS).map((item) => ({
            ...item,
            title: item.title.slice(0, 120),
          })),
        };
      }

      const visible = currentThreads.map((thread) => ({
        environmentId: thread.environmentId,
        threadId: thread.threadId,
        title: thread.title,
      }));
      const matches = findVisibleAssistantThreadMatches(resolved.action.title, visible);
      if (!matches.length) return refused("missing-thread");
      if (matches.length !== 1) return { kind: "ambiguous", matches: matches.length };
      return {
        kind: "open-thread",
        thread: { ...matches[0]!, title: matches[0]!.title.slice(0, 120) },
      };
    },
  };
}
