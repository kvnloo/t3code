import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");

function makeReadModel(sessionStatus: OrchestrationSessionStatus | null) {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session:
          sessionStatus === null
            ? null
            : {
                threadId: THREAD_ID,
                status: sessionStatus,
                providerName: "codex",
                providerInstanceId: ProviderInstanceId.make("codex"),
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: null,
                updatedAt: NOW,
              },
      },
    ],
    updatedAt: NOW,
  } satisfies OrchestrationReadModel;
}

function revertCommand(type: "thread.checkpoint.revert" | "thread.conversation.revert") {
  return {
    type,
    commandId: CommandId.make("cmd-revert"),
    threadId: THREAD_ID,
    turnCount: 1,
    createdAt: NOW,
  } as const;
}

it.layer(NodeServices.layer)("revert during active turn decider", (it) => {
  it.effect("rejects checkpoint revert while the session is running", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          command: revertCommand("thread.checkpoint.revert"),
          readModel: makeReadModel("running"),
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("rejects conversation revert while the session is starting", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          command: revertCommand("thread.conversation.revert"),
          readModel: makeReadModel("starting"),
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("accepts checkpoint revert when the session is idle", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: revertCommand("thread.checkpoint.revert"),
        readModel: makeReadModel("idle"),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.checkpoint-revert-requested");
    }),
  );

  it.effect("accepts conversation revert when there is no session", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: revertCommand("thread.conversation.revert"),
        readModel: makeReadModel(null),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.checkpoint-revert-requested");
    }),
  );
});
