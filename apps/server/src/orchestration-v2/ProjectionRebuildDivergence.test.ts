import { assert, it } from "@effect/vitest";
import {
  EventId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";

const database = SqlitePersistence.layerMemory;
const eventStoreProvided = EventStore.layer.pipe(Layer.provideMerge(database));
const projectionStoreProvided = ProjectionStore.layer.pipe(Layer.provideMerge(database));
const stores = Layer.mergeAll(database, eventStoreProvided, projectionStoreProvided);
const layerTest = Layer.mergeAll(
  stores,
  EventSink.layer.pipe(Layer.provide(stores)),
  ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
  TurnItemPositionStore.layer.pipe(Layer.provide(database)),
);

const providerInstanceId = ProviderInstanceId.make("codex");

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: "Rebuild divergence",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function reasoningItem(threadId: ThreadId, now: DateTime.Utc, key: string) {
  return {
    id: EventId.make(`event:rebuild-divergence:${key}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`turn-item:rebuild-divergence:${key}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: key,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      type: "reasoning",
      text: `${key} text`,
      streaming: false,
    },
  } satisfies OrchestrationV2DomainEvent;
}

// RunExecutionService reserves a position for a streaming assistant/reasoning item that the
// streaming filter holds back. If the run ends before the item is ever delivered, the live
// table keeps that reservation with no event behind it, so rebuild cannot recreate it.
it.effect("rebuild drops a held item's orphan position but keeps every item's ordinal", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const positions = yield* TurnItemPositionStore.TurnItemPositionStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:rebuild-divergence");
    const thread = makeThread(threadId, now);
    yield* sink.write({
      events: [
        {
          id: EventId.make("event:rebuild-divergence:thread"),
          type: "thread.created",
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });

    yield* sink.write({ events: [reasoningItem(threadId, now, "before")] });
    // The held item: a position is reserved, but no turn-item.updated is ever written.
    const held = TurnItemId.make("turn-item:rebuild-divergence:held");
    assert.strictEqual(yield* positions.allocate({ threadId, turnItemId: held, runId: null }), 2);
    yield* sink.write({ events: [reasoningItem(threadId, now, "after")] });

    const readPositions = sql<{ readonly turn_item_id: string; readonly ordinal: number }>`
      SELECT turn_item_id, ordinal
      FROM orchestration_v2_turn_item_positions
      WHERE thread_id = ${threadId}
      ORDER BY ordinal ASC
    `;
    const livePositions = yield* readPositions;
    const liveProjection = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(
      livePositions.map((row) => [row.turn_item_id, row.ordinal]),
      [
        ["turn-item:rebuild-divergence:before", 1],
        [held, 2],
        ["turn-item:rebuild-divergence:after", 3],
      ],
    );

    assert.isTrue((yield* maintenance.rebuild).valid);

    // Only the orphan reservation is gone; the gap it left stays, so item order is unchanged.
    assert.deepEqual(
      (yield* readPositions).map((row) => [row.turn_item_id, row.ordinal]),
      [
        ["turn-item:rebuild-divergence:before", 1],
        ["turn-item:rebuild-divergence:after", 3],
      ],
    );
    assert.deepEqual(yield* projections.getThreadProjection(threadId), liveProjection);
    // The next allocation lands where it would have landed without the rebuild.
    assert.strictEqual(
      yield* positions.allocate({
        threadId,
        turnItemId: TurnItemId.make("turn-item:rebuild-divergence:next"),
        runId: null,
      }),
      4,
    );
  }).pipe(Effect.provide(layerTest)),
);
