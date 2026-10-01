import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const appendActivity = (
  model: Effect.Success<ReturnType<typeof projectEvent>>,
  sequence: number,
  activity: {
    readonly id: string;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
  },
) =>
  projectEvent(model, {
    sequence,
    eventId: EventId.make(`evt-activity-${sequence}`),
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    type: "thread.activity-appended",
    occurredAt: NOW,
    commandId: CommandId.make(`cmd-activity-${sequence}`),
    causationEventId: null,
    correlationId: CommandId.make(`cmd-activity-${sequence}`),
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-1"),
      activity: {
        id: EventId.make(activity.id),
        tone: "info" as const,
        kind: activity.kind,
        summary: activity.summary,
        payload: activity.payload,
        turnId: null,
        createdAt: NOW,
        sequence,
      },
    },
  });

const seedReadModel = Effect.gen(function* () {
  const initial = createEmptyReadModel(NOW);
  const withProject = yield* projectEvent(initial, {
    sequence: 1,
    eventId: EventId.make("evt-project-create"),
    aggregateKind: "project",
    aggregateId: ProjectId.make("project-1"),
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-project-create"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: ProjectId.make("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  return yield* projectEvent(withProject, {
    sequence: 2,
    eventId: EventId.make("evt-thread-create"),
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    type: "thread.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-thread-create"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-thread-create"),
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
});

it.layer(NodeServices.layer)("projector retains open approvals past the activity cap", (it) => {
  it.effect("an unresolved approval.requested survives 500 later activities", () =>
    Effect.gen(function* () {
      let model = yield* seedReadModel;
      model = yield* appendActivity(model, 3, {
        id: "activity-approval-requested",
        kind: "approval.requested",
        summary: "App access requested",
        payload: { requestId: "approval-1" },
      });
      for (let n = 0; n < 501; n++) {
        model = yield* appendActivity(model, 4 + n, {
          id: `activity-filler-${n}`,
          kind: "message.appended",
          summary: `filler ${n}`,
          payload: {},
        });
      }
      const thread = model.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread).toBeDefined();
      expect(thread?.activities.some((activity) => activity.kind === "approval.requested")).toBe(
        true,
      );
    }),
  );

  it.effect("settle stays blocked while the retained approval is open", () =>
    Effect.gen(function* () {
      let model = yield* seedReadModel;
      model = yield* appendActivity(model, 3, {
        id: "activity-approval-requested",
        kind: "approval.requested",
        summary: "App access requested",
        payload: { requestId: "approval-1" },
      });
      for (let n = 0; n < 501; n++) {
        model = yield* appendActivity(model, 4 + n, {
          id: `activity-filler-${n}`,
          kind: "message.appended",
          summary: `filler ${n}`,
          payload: {},
        });
      }
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.settle",
          commandId: CommandId.make("cmd-settle"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: model,
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "OrchestrationThreadSettleBlockedError" });
    }),
  );

  it.effect("a resolved approval is still evicted past the activity cap", () =>
    Effect.gen(function* () {
      let model = yield* seedReadModel;
      model = yield* appendActivity(model, 3, {
        id: "activity-approval-requested",
        kind: "approval.requested",
        summary: "App access requested",
        payload: { requestId: "approval-1" },
      });
      model = yield* appendActivity(model, 4, {
        id: "activity-approval-resolved",
        kind: "approval.resolved",
        summary: "Approval resolved",
        payload: { requestId: "approval-1" },
      });
      for (let n = 0; n < 501; n++) {
        model = yield* appendActivity(model, 5 + n, {
          id: `activity-filler-${n}`,
          kind: "message.appended",
          summary: `filler ${n}`,
          payload: {},
        });
      }
      const thread = model.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread).toBeDefined();
      expect(thread?.activities.some((activity) => activity.kind === "approval.requested")).toBe(
        false,
      );
    }),
  );
});
