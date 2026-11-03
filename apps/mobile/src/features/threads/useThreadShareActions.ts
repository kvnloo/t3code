import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  MessageId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { handoffThreadTitle, threadHandoffDisabledReason } from "@t3tools/shared/threadHandoff";
import { Atom } from "effect/reactivity";
import * as Clipboard from "expo-clipboard";
import { useMemo, useRef, useState } from "react";
import { Share } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { useThreadGuestShare } from "./ThreadGuestShareBar";
import { waitForThreadShellReady } from "./threadForkNavigation";
import {
  buildThreadShareActions,
  guestShareCreateFailureMessage,
  type ThreadShareActionId,
} from "./threadShareMenu";

const NO_THREAD_REASON = "Open a thread to hand it off.";
const NO_THREAD_REASON_ATOM = Atom.make<string | null>(NO_THREAD_REASON);

function handoffReasonAtom(ref: ScopedThreadRef) {
  return Atom.make((get): string | null => {
    const detail = get(environmentThreadDetails.threadAtom(ref));
    return detail === null || detail === undefined
      ? "The thread is still loading."
      : threadHandoffDisabledReason(detail.projection.runs);
  });
}

function failureMessage(
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  fallback: string,
) {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/**
 * The thread's share and handoff actions for the header menus and the command palette, and
 * `handoff`, which `/handoff` in the composer also runs. `threadRef` is null on screens without a
 * server thread, where no actions are offered.
 */
export function useThreadShareActions(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
) {
  const threadRef = useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );
  const canOperateThread = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canCreateGuestShare = useAtomValue(
    serverEnvironment.createGuestShare.permissionAtom(environmentId),
  );
  const reasonAtom = useMemo(
    () => (threadRef === null ? NO_THREAD_REASON_ATOM : handoffReasonAtom(threadRef)),
    [threadRef],
  );
  const handoffDisabledReason = useAtomValue(reasonAtom);
  const share = useThreadGuestShare(threadRef);
  const selectDetail = useSelectWorkspaceDetail();
  const forkForHandoff = useAtomCommand(threadEnvironment.forkForHandoff, {
    label: "hand off thread",
    reportFailure: false,
  });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, {
    label: "send handoff message",
    reportFailure: false,
  });
  const createGuestShare = useAtomCommand(serverEnvironment.createGuestShare, {
    label: "create guest link",
    reportFailure: false,
  });
  const closeGuestShare = useAtomCommand(threadEnvironment.closeGuestShare, "stop guest sharing");
  const pendingRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const runExclusive = async <A>(work: () => Promise<A>, idle: A): Promise<A> => {
    if (pendingRef.current) return idle;
    pendingRef.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  /** Forks into a new thread, opens it, and sends `focus` there first. False when nothing opened. */
  const handoff = (focus?: string): Promise<boolean> =>
    runExclusive(async () => {
      if (threadRef === null) return false;
      const reason = appAtomRegistry.get(reasonAtom);
      if (reason !== null) {
        Dialog.alert("Cannot hand off yet", reason);
        return false;
      }
      const source = appAtomRegistry.get(environmentThreadShells.threadShellAtom(threadRef));
      const targetThreadId = ThreadId.make(uuidv4());
      const targetRef = scopeThreadRef(threadRef.environmentId, targetThreadId);
      const fork = await forkForHandoff({
        environmentId: threadRef.environmentId,
        input: {
          sourceThreadId: threadRef.threadId,
          targetThreadId,
          title: handoffThreadTitle(source?.title ?? ""),
          creationSource: "mobile",
        },
      });
      if (fork._tag !== "Success") {
        if (!isAtomCommandInterrupted(fork)) {
          Dialog.alert("Could not hand off", failureMessage(fork, "Try again."));
        }
        return false;
      }
      const targetShellAtom = environmentThreadShells.threadShellAtom(targetRef);
      const ready = await waitForThreadShellReady({
        read: () => appAtomRegistry.get(targetShellAtom) !== null,
      });
      const target = appAtomRegistry.get(targetShellAtom);
      if (!ready || target === null) {
        Dialog.alert(
          "Handoff created",
          "Its thread data did not reach this client. Reconnect and try opening it from the thread list.",
        );
        return false;
      }
      const text = focus?.trim();
      if (text) {
        const turn = await startTurn({
          environmentId: threadRef.environmentId,
          input: {
            threadId: targetThreadId,
            message: { messageId: MessageId.make(uuidv4()), role: "user", text, attachments: [] },
            runtimeMode: target.runtimeMode,
            interactionMode: target.interactionMode,
            createdAt: new Date().toISOString(),
          },
        });
        if (turn._tag !== "Success" && !isAtomCommandInterrupted(turn)) {
          Dialog.alert(
            "Handoff message not sent",
            `${failureMessage(turn, "Try again.")} The new thread is open; send it there.`,
          );
        }
      }
      selectDetail({
        name: "Thread",
        params: { environmentId: threadRef.environmentId, threadId: targetThreadId },
      });
      return true;
    }, false);

  const createAndShareLink = () =>
    runExclusive(async () => {
      if (threadRef === null) return;
      const result = await createGuestShare({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag !== "Success") {
        if (!isAtomCommandInterrupted(result)) {
          Dialog.alert(
            "Could not create a guest link",
            guestShareCreateFailureMessage(squashAtomCommandFailure(result)),
          );
        }
        return;
      }
      const { url } = result.value;
      // The link is shown only now; copy it so it survives a dismissed share sheet.
      await Clipboard.setStringAsync(url).catch(() => undefined);
      await Share.share({ message: url, url, title: "T3 Code guest link" }).catch(() => {
        Dialog.alert("Guest link copied", url);
      });
    }, undefined);

  const shareWithGuest = () => {
    if (share === null) {
      void createAndShareLink();
      return;
    }
    Dialog.confirm({
      title: "Make a new guest link?",
      message: "The current link stops working and its guest loses access.",
      confirmText: "New link",
      onConfirm: () => void createAndShareLink(),
    });
  };

  const stopSharing = () => {
    if (threadRef === null) return;
    Dialog.confirm({
      title: "Stop sharing?",
      message: "The guest loses access and the link stops working.",
      confirmText: "Stop sharing",
      destructive: true,
      onConfirm: () =>
        void runExclusive(async () => {
          await closeGuestShare({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
        }, undefined),
    });
  };

  const hasGuestShare = share !== null;
  const actions = useMemo(
    () =>
      threadRef === null
        ? []
        : buildThreadShareActions({
            canOperateThread,
            handoffDisabledReason: busy ? "Working…" : handoffDisabledReason,
            canCreateGuestShare,
            hasGuestShare,
          }),
    [threadRef, canOperateThread, busy, handoffDisabledReason, canCreateGuestShare, hasGuestShare],
  );

  const run = (id: ThreadShareActionId) => {
    if (id === "handoff") void handoff();
    else if (id === "share-guest") shareWithGuest();
    else stopSharing();
  };

  return {
    actions,
    run,
    handoff,
    handoffDisabledReason: canOperateThread
      ? handoffDisabledReason
      : "This connection cannot start threads.",
  };
}
