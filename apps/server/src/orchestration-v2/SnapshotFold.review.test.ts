// Review r1 for exp/poh/02-snapshot-dedupe: the repros for findings M1 and M2, kept as
// regression tests for their fixes.
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
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { subscribeOrchestrationV2Thread } from "../ws.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

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
const everything = Number.MAX_SAFE_INTEGER;

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

// M1: provider-thread.updated also sets thread.activeProviderThreadId, so folding A's newest body
// back to A's first row would put it before B. The fold leaves provider threads alone; a message
// streaming across the switch is still folded.
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
    yield* sink.write({ events: [messageEvent(threadId, now, "across", 0, false)] });
    yield* sink.write({ events: [providerThreadEvent(threadId, now, "b", 1, 2)] });
    yield* sink.write({ events: [messageEvent(threadId, now, "across", 1, true)] });
    yield* sink.write({ events: [providerThreadEvent(threadId, now, "a", 2, 3)] });
    // Something unrelated is the stream's newest row, so A is eligible.
    yield* sink.write({ events: [messageEvent(threadId, now, "tail", 0, true)] });

    const before = yield* projections.getThreadProjection(threadId);
    assert.equal(
      before.thread.activeProviderThreadId,
      ProviderThreadId.make(`provider-thread:review:${threadId}:a`),
    );

    yield* maintenance.compactEventStore();
    const folded = yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });
    assert.equal(folded.foldedEntityCount, 1);
    const providerThreadRows = (yield* eventStore
      .read({ threadId })
      .pipe(Stream.runCollect)).filter((stored) => stored.event.type === "provider-thread.updated");
    assert.lengthOf(providerThreadRows, 3);

    assert.isTrue((yield* maintenance.rebuild).valid);
    const rebuilt = yield* projections.getThreadProjection(threadId);
    assert.equal(
      rebuilt.thread.activeProviderThreadId,
      before.thread.activeProviderThreadId,
      "rebuild of folded log",
    );
  }).pipe(Effect.provide(layerTest)),
);

// M2: a fold committing between subscribeThread's stats check and its replay read moves the final
// body behind the cursor. Resume re-checks the watermark after the read; this drives the real
// path with the fold injected exactly there.
it.effect(
  "a fold committing between the resume stats check and the replay read falls back to a snapshot",
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
      yield* sink.write({ events: [messageEvent(threadId, now, "m", 1, true)] });
      yield* sink.write({ events: [messageEvent(threadId, now, "tail", 0, true)] });
      const expected = yield* projections.getThreadProjection(threadId);

      const resume = (foldBeforeRead: boolean) => {
        let folds = foldBeforeRead ? 1 : 0;
        return subscribeOrchestrationV2Thread({
          threadId,
          afterSequence: cursor,
          requestCompletionMarker: true,
        }).pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.map((items) => Array.from(items)),
          Effect.provideService(OrchestrationEventStore.OrchestrationEventStore, {
            ...applicationEvents,
            // The background pass commits after the stats check, right before the read.
            readAgentEvents: (input) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  if (folds > 0) {
                    folds -= 1;
                    const folded = yield* maintenance.foldSupersededSnapshots({
                      settledThrough: everything,
                    });
                    assert.equal(folded.foldedEntityCount, 1);
                  }
                  return applicationEvents.readAgentEvents(input);
                }).pipe(Effect.orDie),
              ),
          }),
          Effect.provideService(ThreadManagement.ThreadManagementService, {
            ensureLegacyTranscript: () => Effect.void,
            getThreadSnapshot: (id: ThreadId) => projections.getThreadSnapshot(id),
            streamStoredEventsFrom: () => Stream.empty,
          } as unknown as ThreadManagement.ThreadManagementService["Service"]),
        );
      };

      // Control: without a racing fold the cursor replays event by event.
      const replayed = yield* resume(false);
      assert.deepEqual(
        replayed.map((item) => item.kind),
        ["event", "event", "synchronized"],
      );

      const raced = yield* resume(true);
      assert.deepEqual(
        raced.map((item) => item.kind),
        ["snapshot", "synchronized"],
      );
      const snapshot = raced[0]!;
      assert.isTrue(snapshot.kind === "snapshot");
      if (snapshot.kind !== "snapshot" || !("projection" in snapshot)) return;
      assert.deepEqual(
        snapshot.projection.messages.map((message) => [message.text, message.streaming]),
        expected.messages.map((message) => [message.text, message.streaming]),
      );
      assert.deepEqual(
        snapshot.projection.messages.map((message) => [message.text, message.streaming]),
        [
          ["answer m 1", false],
          ["answer tail 0", false],
        ],
      );
    }).pipe(Effect.provide(layerTest)),
);
