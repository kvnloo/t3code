import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { handoffThreadTitle } from "@t3tools/shared/threadHandoff";
import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import { newMessageId, newThreadId } from "~/lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { readThreadShell, waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";

/**
 * `/handoff [focus]`: forks `threadRef` at its latest finished reply into a new listed thread,
 * opens it, and sends `focus` there as its first message. `open` resolves false when no new
 * thread opened, or another handoff is still starting. Offers none when `threadRef` is null.
 */
export function useThreadHandoff(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly onError: (message: string) => void;
}) {
  const pendingRef = useRef(false);
  const navigate = useNavigate();
  const forkForHandoff = useAtomCommand(threadEnvironment.forkForHandoff, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const reportFailure = (
    failure: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
    fallback: string,
  ) => {
    if (isAtomCommandInterrupted(failure)) return;
    const error = squashAtomCommandFailure(failure);
    input.onError(error instanceof Error ? error.message : fallback);
  };
  const start = async (threadRef: ScopedThreadRef, focus: string | undefined) => {
    const targetThreadId = newThreadId();
    const targetThreadRef = scopeThreadRef(threadRef.environmentId, targetThreadId);
    const fork = await forkForHandoff({
      environmentId: threadRef.environmentId,
      input: {
        sourceThreadId: threadRef.threadId,
        targetThreadId,
        title: handoffThreadTitle(readThreadShell(threadRef)?.title ?? ""),
      },
    });
    if (fork._tag === "Failure") {
      reportFailure(fork, "Could not hand off this thread.");
      return false;
    }
    if (!(await waitForThreadShell(targetThreadRef))) {
      input.onError(
        "The handoff thread was created, but it did not reach this client. Reconnect and open it from the sidebar.",
      );
      return false;
    }
    const target = readThreadShell(targetThreadRef);
    const text = focus?.trim();
    if (text && target) {
      const turn = await startThreadTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: targetThreadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          runtimeMode: target.runtimeMode,
          interactionMode: target.interactionMode,
          createdAt: new Date().toISOString(),
        },
      });
      // The new thread still opens; the focus can be sent there by hand.
      if (turn._tag === "Failure") reportFailure(turn, "Could not send the handoff message.");
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
    return true;
  };
  const open = async (focus?: string) => {
    const { threadRef } = input;
    if (!threadRef || pendingRef.current) return false;
    pendingRef.current = true;
    return start(threadRef, focus).finally(() => {
      pendingRef.current = false;
    });
  };
  return { available: input.threadRef !== null, open: useStableCallback(open) };
}
