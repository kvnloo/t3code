// Review r1 for exp/poh/02-snapshot-dedupe: failing repros for the snapshot fold.
import { applyOrchestrationV2ProjectionEvent } from "../../../../packages/client-runtime/src/state/orchestrationV2Projection.ts";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const database = SqlitePersistence.layerMemory;
const stores = Layer.mergeAll(
  database,
  EventStore.layer.pipe(Layer.provideMerge(database)),
  ProjectionStore.layer.pipe(Layer.provideMerge(database)),
  OrchestrationEventStore.layer.pipe(Layer.provideMerge(database)),
);
const layerTest = Layer.mergeAll(
  stores,
  EventSink.layer.pipe(Layer.provide(stores)),
  ProjectionMaintenance.layer.pipe(Layer.provide(stores)),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const farFuture = (now: DateTime.Utc) => DateTime.formatIso(DateTime.add(now, { hours: 1 }));

function threadCreated(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2DomainEvent {
  const thread: OrchestrationV2AppThread = {
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: "Snapshot fold review",
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
  return {
    id: EventId.make(`event:review:thread:${threadId}`),
    type: "thread.created",
    threadId,
    providerInstanceId,
    occurredAt: now,
    payload: thread,
  };
}

function providerThreadEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  key: "a" | "b",
  revision: number,
  runOrdinal: number,
): OrchestrationV2DomainEvent {
  const at = DateTime.add(now, { seconds: revision });
  return {
    id: EventId.make(`event:review:${threadId}:pt-${key}:${revision}`),
    type: "provider-thread.updated",
    threadId,
    occurredAt: at,
    payload: {
      id: ProviderThreadId.make(`provider-thread:review:${threadId}:${key}`),
      driver,
      providerInstanceId,
      providerSessionId: null,
      appThreadId: threadId,
      ownerNodeId: null,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: 1,
      lastRunOrdinal: runOrdinal,
      handoffIds: [],
      forkedFrom: null,
      pendingBackgroundTasks: [],
      contextUsage: null,
      nativeMetadata: null,
      goal: null,
      createdAt: now,
      updatedAt: at,
    },
  };
}

function messageEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  key: string,
  revision: number,
  final: boolean,
): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(`event:review:${threadId}:message-${key}:${revision}`),
    type: "message.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: MessageId.make(`message:review:${threadId}:${key}`),
      threadId,
      runId: null,
      nodeId: null,
      role: "assistant",
      text: `answer ${key} ${revision}`,
      attachments: [],
      streaming: !final,
      createdBy: "agent",
      creationSource: "provider",
      createdAt: now,
      updatedAt: now,
    },
  };
}

function replayOnClient(
  base: OrchestrationV2ThreadProjection,
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
) {
  let projection: OrchestrationV2ThreadProjection | null = base;
  for (const stored of events) {
    projection = applyOrchestrationV2ProjectionEvent(projection, stored.event, {
      partialTimeline: true,
      latestLocalTurnOrdinal: null,
    });
  }
  return projection!;
}

// Finding 1: provider-thread.updated is not a pure per-entity upsert. On the server each one also
// sets thread.activeProviderThreadId (ProjectionStore.ts:893 in-memory, :2326 SQL), so the
// *relative order* of different provider threads matters.
// Moving A's newest body back to A's first row reorders it before B.
it.effect("fold keeps the active provider thread across a switch back (rebuild)", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:review-switch-back");

    yield* sink.write({ events: [threadCreated(threadId, now)] });
    // Run 1 on provider thread A, run 2 switches to B, run 3 switches back to A.
    yield* sink.write({ events: [providerThreadEvent(threadId, now, "a", 0, 1)] });
    yield* sink.write({ events: [providerThreadEvent(threadId, now, "b", 1, 2)] });
    yield* sink.write({ events: [providerThreadEvent(threadId, now, "a", 2, 3)] });
    // Something unrelated is the stream's newest row, so A is eligible.
    yield* sink.write({ events: [messageEvent(threadId, now, "tail", 0, true)] });

    const before = yield* projections.getThreadProjection(threadId);
    assert.equal(
      before.thread.activeProviderThreadId,
      ProviderThreadId.make(`provider-thread:review:${threadId}:a`),
    );

    yield* maintenance.compactEventStore();
    const folded = yield* maintenance.foldSupersededSnapshots({ settledBefore: farFuture(now) });
    assert.equal(folded.foldedEntityCount, 1);

    assert.isTrue((yield* maintenance.rebuild).valid);
    const rebuilt = yield* projections.getThreadProjection(threadId);
    assert.equal(
      rebuilt.thread.activeProviderThreadId,
      before.thread.activeProviderThreadId,
      "rebuild of folded log",
    );
  }).pipe(Effect.provide(layerTest)),
);

// Finding 2: ws.ts checks the watermark (getAgentReplayStats) and then reads the replay
// (readAgentEvents) in separate, non-transactional statements. A fold that commits in between
// moves the entity's final body behind the cursor and the client never receives it.
it.effect(
  "a fold committing between the resume stats check and the replay read loses the update",
  () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:review-toctou");

      yield* sink.write({ events: [threadCreated(threadId, now)] });
      const first = yield* sink.write({ events: [messageEvent(threadId, now, "m", 0, false)] });
      // The client saw the streaming row and disconnected; its cursor is that row.
      const cursor = first.at(-1)!.sequence;
      const held = yield* projections.getThreadProjection(threadId);
      yield* sink.write({ events: [messageEvent(threadId, now, "m", 1, true)] });
      const tail = yield* sink.write({ events: [messageEvent(threadId, now, "tail", 0, true)] });
      const head = tail.at(-1)!.sequence;
      const expected = yield* projections.getThreadProjection(threadId);

      // ws.ts:974 — stats say "replay".
      const stats = yield* applicationEvents.getAgentReplayStats({
        threadId,
        afterSequence: cursor,
        throughSequence: head,
        maxEvents: 128,
      });
      assert.isFalse(stats.crossesSnapshotFold);

      // The background pass commits here (nothing in ws.ts prevents it).
      yield* maintenance.foldSupersededSnapshots({ settledBefore: farFuture(now) });

      // ws.ts:1018 — loadReplayThrough reads after the check.
      const replay = yield* applicationEvents
        .readAgentEvents({ threadId, afterSequence: cursor, throughSequence: head })
        .pipe(Stream.runCollect);
      const client = replayOnClient(held, Array.from(replay));
      assert.deepEqual(client.messages, expected.messages, "client misses the final message body");
    }).pipe(Effect.provide(layerTest)),
);
