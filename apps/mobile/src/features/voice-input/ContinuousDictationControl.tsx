import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, View } from "react-native";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  type EnvironmentId,
  type ServerConfig,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveComposerDispatchMode } from "@t3tools/client-runtime/state/composer-dispatch";

import { AppText as Text } from "../../components/ui/AppText";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import type { FollowUpBehavior } from "../../lib/followUpBehavior";
import { isModelSelectionUnavailable } from "../../lib/modelOptions";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { resolveProviderInteractionMode } from "../../state/legacy-plan-mode";
import { readEnvironmentScope } from "../../state/session";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { ContinuousVoiceSession } from "./continuousVoiceSession";
import { useGlobalVoiceInput } from "./VoiceInputProvider";

export type ContinuousDictationControlProps = {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly connected: boolean;
  readonly disabled: boolean;
  readonly running: boolean;
  readonly canSteer: boolean;
  readonly followUpBehavior: FollowUpBehavior;
  readonly serverConfig: ServerConfig | null;
};

function canCapture(input: ContinuousDictationControlProps): boolean {
  return (
    input.connected &&
    !input.disabled &&
    input.environmentId === input.thread.environmentId &&
    !input.thread.hasPendingApprovals &&
    !input.thread.hasPendingUserInput
  );
}

export function ContinuousDictationControl(props: ContinuousDictationControlProps) {
  const global = useGlobalVoiceInput();
  const { session } = global;
  const latest = useRef(props);
  // oxlint-disable-next-line react/refs -- Async capture reads the current destination and delivery policy, never a stale render.
  latest.current = props;
  const focused = useRef(false);
  const ownerKey = scopedThreadKey(props.environmentId, props.thread.id);
  const [continuous] = useState(
    () =>
      new ContinuousVoiceSession({
        isCurrent: () =>
          focused.current &&
          AppState.currentState === "active" &&
          canCapture(latest.current) &&
          scopedThreadKey(latest.current.environmentId, latest.current.thread.id) === ownerKey,
        recordingState: () => session.controller.currentState,
        sample: () => session.sample(),
        startRecording: (commit) =>
          session.start(
            {
              ownerKey,
              label: "Hands-free voice",
              readDraft: () => ({
                ownerKey,
                text: "",
                selection: { start: 0, end: 0 },
                revision: 0,
              }),
              commitDraft: (text) => commit(text),
              subscribe: () => () => {},
            },
            true,
          ),
        finishRecording: () => session.controller.stop(),
        cancelRecording: () => session.controller.cancel(),
        submit: async (text, signal) => {
          const current = latest.current;
          if (
            signal.aborted ||
            !focused.current ||
            !canCapture(current) ||
            scopedThreadKey(current.environmentId, current.thread.id) !== ownerKey
          ) return;
          if (!readEnvironmentScope(current.environmentId, AuthOrchestrationOperateScope)) {
            throw new Error("Permission to send to this thread was lost.");
          }
          const draft = getComposerDraftSnapshot(ownerKey);
          const modelSelection = draft.modelSelection ?? current.thread.modelSelection;
          if (isModelSelectionUnavailable(current.serverConfig, modelSelection, current.thread.projectId)) {
            throw new Error("The selected model is unavailable.");
          }
          const provider = current.serverConfig?.providers.find(
            (entry) => entry.instanceId === modelSelection.instanceId,
          );
          const action = resolveComposerDispatchMode({
            running: current.running && current.canSteer,
            alternateModifier: false,
            activeTurnDefault: current.followUpBehavior,
          });
          const setupRunning = [current.thread.latestRun?.status, current.thread.runtime?.status].some(
            (status) => status === "preparing" || status === "starting",
          );
          const dispatchMode = setupRunning
            ? "queue"
            : action === "auto"
              ? null
              : action === "queue"
                ? "queue"
                : "auto";
          const metadata = makeQueuedMessageMetadata();
          await enqueueThreadOutboxMessage({
            environmentId: current.environmentId,
            threadId: current.thread.id,
            messageId: MessageId.make(metadata.messageId),
            commandId: CommandId.make(metadata.commandId),
            text,
            attachments: [],
            modelSelection,
            runtimeMode: draft.runtimeMode ?? current.thread.runtimeMode,
            interactionMode: resolveProviderInteractionMode(
              provider,
              draft.interactionMode ?? current.thread.interactionMode,
            ),
            ...(dispatchMode === null ? {} : { dispatchMode }),
            createdAt: metadata.createdAt,
          });
        },
      }),
  );
  const state = useSyncExternalStore(continuous.subscribe, continuous.getSnapshot);
  const eligible = canCapture(props);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        continuous.stop();
      };
    }, [continuous]),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancels native capture and late transcripts when its environment disconnects or the composer locks.
  useEffect(() => {
    if (!eligible) continuous.stop();
  }, [continuous, eligible]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Disposes this microphone owner on unmount without cancelling a replacement owner's capture.
  useEffect(
    () => () => {
      continuous.dispose();
      if (session.continuous === continuous) session.continuous = null;
    },
    [continuous, session],
  );

  const active = continuous.isActive;
  const unavailable = !global.isAvailable;
  const start = () => {
    if (unavailable || !eligible || global.isBusy) return;
    if (session.continuous !== continuous) session.continuous?.stop();
    session.continuous = continuous;
    void continuous.start();
  };
  const status = state.error ?? (
    unavailable
      ? "Hands-free unavailable: no transcription capability on this platform."
      : props.thread.hasPendingApprovals || props.thread.hasPendingUserInput
        ? "Resolve the pending request before starting hands-free voice."
        : state.phase === "idle"
          ? "Opt in to send each spoken utterance; typed drafts stay unchanged."
          : state.phase
  );
  return (
    <View className="gap-2 px-3 py-2">
      <View className="flex-row items-center gap-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? "Stop hands-free voice" : "Start hands-free voice"}
          disabled={!active && (unavailable || !eligible || global.isBusy)}
          onPress={active ? () => continuous.stop() : start}
        >
          <Text className="text-sm text-foreground">
            {active ? "Stop hands-free" : state.phase === "muted" ? "Resume hands-free" : "Hands-free voice"}
          </Text>
        </Pressable>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mute hands-free microphone"
            onPress={() => continuous.stop(true)}
          >
            <Text className="text-sm text-foreground">Mute</Text>
          </Pressable>
        ) : null}
      </View>
      <Text accessibilityLiveRegion="polite" className="text-xs text-muted-foreground">
        {status}
      </Text>
    </View>
  );
}
