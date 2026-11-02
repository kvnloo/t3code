// Review r2 for exp/poh/02-snapshot-dedupe: repros for the round-2 findings.
import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
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
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as EventStore from "./EventStore.ts";
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
const everything = Number.MAX_SAFE_INTEGER;

function threadCreated(threadId: ThreadId, at: DateTime.Utc): OrchestrationV2DomainEvent {
  const thread: OrchestrationV2AppThread = {
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: "Snapshot fold review r2",
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
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  return {
    id: EventId.make(`event:review2:thread:${threadId}`),
    type: "thread.created",
    threadId,
    providerInstanceId,
    occurredAt: at,
    payload: thread,
  };
}

function messageEvent(
  threadId: ThreadId,
  at: DateTime.Utc,
  key: string,
  revision: number,
  final: boolean,
): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(`event:review2:${threadId}:message-${key}:${revision}`),
    type: "message.updated",
    threadId,
    occurredAt: at,
    payload: {
      id: MessageId.make(`message:review2:${threadId}:${key}`),
      threadId,
      runId: null,
      nodeId: null,
      role: "assistant",
      text: `answer ${key} ${revision}`,
      attachments: [],
      streaming: !final,
      createdBy: "agent",
      creationSource: "provider",
      createdAt: at,
      updatedAt: at,
    },
  };
}

function pullRequestLinkUpdated(threadId: ThreadId, at: DateTime.Utc): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(`event:review2:${threadId}:pr-link`),
    type: "thread.pull-request-link-updated",
    threadId,
    providerInstanceId,
    occurredAt: at,
    payload: {
      host: "github.com",
      repository: "example/repo",
      number: 1,
      url: "https://github.com/example/repo/pull/1",
      source: "agent",
      linkedAt: DateTime.formatIso(at),
      snapshot: null,
      stack: null,
    },
  };
}

// r2-1: the fold treats thread.pull-request-link-updated as activity, but the server SQL apply
// (ProjectionStore.ts:1899 re-applies the current thread row; the updated_at tail at :2739
// excludes it) and in-memory applyToProjection (:784) keep the previous updatedAt. When a PR sync
// is the only thing after a message's final row, the fold deletes the row that set updatedAt.
it.effect("rebuild after a fold keeps thread.updatedAt when a PR link sync follows", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const epoch = yield* DateTime.now;
    const at = (seconds: number) => DateTime.add(epoch, { seconds });
    const threadId = ThreadId.make("thread:review2-pr-link-tail");

    yield* sink.write({ events: [threadCreated(threadId, at(0))] });
    yield* sink.write({ events: [messageEvent(threadId, at(1), "m", 0, false)] });
    yield* sink.write({ events: [messageEvent(threadId, at(2), "m", 1, true)] });
    // PR sync reactor polls the linked PR long after the turn.
    yield* sink.write({ events: [pullRequestLinkUpdated(threadId, at(3))] });

    const live = yield* projections.getThreadProjection(threadId);
    assert.equal(DateTime.formatIso(live.thread.updatedAt), DateTime.formatIso(at(2)));
    // Control: rebuild of the unfolded log matches live.
    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.equal(
      DateTime.formatIso((yield* projections.getThreadProjection(threadId)).thread.updatedAt),
      DateTime.formatIso(at(2)),
      "control rebuild",
    );

    // Folds m today (foldedEntityCount 1); a fix may instead skip it.
    yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });
    assert.isTrue((yield* maintenance.rebuild).valid);
    const rebuilt = yield* projections.getThreadProjection(threadId);
    assert.equal(
      DateTime.formatIso(rebuilt.thread.updatedAt),
      DateTime.formatIso(live.thread.updatedAt),
      "thread.updatedAt after rebuild of the folded log",
    );
  }).pipe(Effect.provide(layerTest)),
);

// r2-2: the M2 re-check covers the replay read, not the live tail's catch-up. The tail starts
// lazily, after the client acks the snapshot (or replay) chunk, and catches up from the DB from
// snapshotSequence. If the entity got its final row after the snapshot and a fold committed before
// the tail started, the final body sits at a row below the cursor and the tail never sends it.
it.effect("live tail catch-up after a fold still delivers the final body", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const epoch = yield* DateTime.now;
    const at = (seconds: number) => DateTime.add(epoch, { seconds });

    const run = (name: string, foldBeforeTail: boolean) =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(`thread:review2-tail-${name}`);
        yield* sink.write({ events: [threadCreated(threadId, at(0))] });
        yield* sink.write({ events: [messageEvent(threadId, at(1), "m", 0, false)] });
        let tailStarts = 1;
        const items = yield* subscribeOrchestrationV2Thread({
          threadId,
          requestCompletionMarker: true,
        }).pipe(
          Effect.flatMap((stream) => stream.pipe(Stream.take(3), Stream.runCollect)),
          Effect.map((collected) => Array.from(collected)),
          Effect.provideService(ThreadManagement.ThreadManagementService, {
            ensureLegacyTranscript: () => Effect.void,
            getThreadSnapshot: (id: ThreadId) => projections.getThreadSnapshot(id),
            // Real tail (Orchestrator.streamStoredEventsFrom). Its start is the point where the
            // client acked the snapshot; what happened while it had not is injected here.
            streamStoredEventsFrom: (input: {
              readonly threadId?: ThreadId;
              readonly afterSequence?: number;
            }) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  if (tailStarts > 0) {
                    tailStarts -= 1;
                    yield* sink.write({ events: [messageEvent(threadId, at(2), "m", 1, true)] });
                    yield* sink.write({ events: [messageEvent(threadId, at(3), "tail", 0, true)] });
                    if (foldBeforeTail) {
                      const folded = yield* maintenance.foldSupersededSnapshots({
                        settledThrough: everything,
                      });
                      // m here, plus the control thread's m.
                      assert.isAtLeast(folded.foldedEntityCount, 1);
                    }
                  }
                  return sink.stream({ ...input, bounded: true });
                }).pipe(Effect.orDie),
              ),
          } as unknown as ThreadManagement.ThreadManagementService["Service"]),
        );
        assert.deepEqual(
          items.map((item) => item.kind),
          ["snapshot", "synchronized", "event"],
        );
        const event = items[2]!;
        assert.isTrue(event.kind === "event");
        if (event.kind !== "event" || !("event" in event)) return;
        // The first live event must be m's final body: the snapshot showed m streaming.
        assert.equal(event.event.type, "message.updated");
        if (event.event.type !== "message.updated") return;
        assert.deepEqual(
          [event.event.payload.text, event.event.payload.streaming],
          ["answer m 1", false],
          name,
        );
      });

    // Control: without a fold the tail replays m's final row.
    yield* run("control", false);
    yield* run("folded", true);
  }).pipe(Effect.provide(layerTest)),
);
