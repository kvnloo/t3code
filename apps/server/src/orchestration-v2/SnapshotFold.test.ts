import { applyOrchestrationV2ProjectionEvent } from "../../../../packages/client-runtime/src/state/orchestrationV2Projection.ts";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

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
const providerDriver = ProviderDriverKind.make("codex");

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: "Snapshot fold",
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

type ItemKey = "command" | "reasoning" | "todo" | "commanded" | "late";
const ordinals: Record<ItemKey, number> = {
  command: 10,
  reasoning: 20,
  todo: 30,
  commanded: 40,
  late: 60,
};

function itemEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  key: ItemKey,
  revision: number,
  final: boolean,
): OrchestrationV2DomainEvent {
  const growing = `${key}:${revision}:` + "x".repeat((revision + 1) * 128);
  const base = {
    id: TurnItemId.make(`turn-item:fold:${threadId}:${key}`),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: ordinals[key],
    status: final ? ("completed" as const) : ("running" as const),
    title: key,
    startedAt: now,
    completedAt: final ? now : null,
    updatedAt: now,
  };
  let payload: OrchestrationV2TurnItem;
  if (key === "reasoning") {
    payload = { ...base, type: "reasoning", text: growing, streaming: !final };
  } else if (key === "todo") {
    payload = {
      ...base,
      type: "todo_list",
      planId: PlanId.make(`plan:fold:${threadId}`),
      steps: [{ id: "step", text: growing, status: final ? "completed" : "running" }],
      explanation: growing,
    };
  } else {
    payload = { ...base, type: "command_execution", input: `run ${key}`, output: growing };
  }
  return {
    id: EventId.make(`event:fold:${threadId}:${key}:${revision}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: now,
    payload,
  };
}

function messageEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  revision: number,
  final: boolean,
): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(`event:fold:${threadId}:message:${revision}`),
    type: "message.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: MessageId.make(`message:fold:${threadId}`),
      threadId,
      runId: null,
      nodeId: null,
      role: "assistant",
      text: `answer ${revision} ` + "y".repeat(revision * 64),
      attachments: [],
      streaming: !final,
      createdBy: "agent",
      creationSource: "provider",
      createdAt: now,
      updatedAt: now,
    },
  };
}

function subagentItemEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  revision: number,
): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(`event:fold:${threadId}:subagent-item:${revision}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`turn-item:fold:${threadId}:subagent`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 50,
      status: "running",
      title: "Review",
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      type: "subagent",
      subagentId: NodeId.make(`subagent:fold:${threadId}`),
      origin: "provider_native",
      driver: providerDriver,
      providerInstanceId,
      childThreadId: null,
      prompt: "Review the fold. ".repeat(20),
      progress: `progress ${revision}`,
      result: null,
    },
  };
}

function nodeEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  key: "root" | "tool",
  revision: number,
  final: boolean,
): OrchestrationV2DomainEvent {
  const rootNodeId = NodeId.make(`node:fold:${threadId}:root`);
  return {
    id: EventId.make(`event:fold:${threadId}:node-${key}:${revision}`),
    type: "node.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: key === "root" ? rootNodeId : NodeId.make(`node:fold:${threadId}:tool`),
      threadId,
      runId: null,
      parentNodeId: key === "root" ? null : rootNodeId,
      rootNodeId,
      kind: key === "root" ? "root_turn" : "tool_call",
      status: final ? "completed" : "running",
      countsForRun: key === "root",
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      runtimeRequestId: null,
      checkpointScopeId: null,
      startedAt: now,
      completedAt: final ? DateTime.add(now, { seconds: revision }) : null,
    },
  };
}

/** Provider threads A, then B, then A again: the projection's active provider thread is A. */
function providerThreadEvent(
  threadId: ThreadId,
  now: DateTime.Utc,
  key: "a" | "b",
  revision: number,
): OrchestrationV2DomainEvent {
  const at = DateTime.add(now, { seconds: revision });
  return {
    id: EventId.make(`event:fold:${threadId}:provider-thread-${key}:${revision}`),
    type: "provider-thread.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: ProviderThreadId.make(`provider-thread:fold:${threadId}:${key}`),
      driver: providerDriver,
      providerInstanceId,
      providerSessionId: null,
      appThreadId: threadId,
      ownerNodeId: null,
      nativeThreadRef: null,
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: 1,
      lastRunOrdinal: revision + 1,
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

const PROVIDER_THREAD_SWITCHES: ReadonlyArray<"a" | "b"> = ["a", "b", "a"];

const REVISIONS = 6;

/**
 * Writes a thread whose entities stream several snapshots. After revision 0, reasoning is written
 * before command, so only the oldest rows give the client's insertion order (command first).
 */
const seedThread = Effect.fn("seedThread")(function* (threadId: ThreadId, now: DateTime.Utc) {
  const sink = yield* EventSink.EventSinkV2;
  const writes = [
    ...(yield* sink.write({
      events: [
        {
          id: EventId.make(`event:fold:thread:${threadId}`),
          type: "thread.created",
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: makeThread(threadId, now),
        },
      ],
    })),
  ];
  for (let revision = 0; revision < REVISIONS; revision += 1) {
    const final = revision === REVISIONS - 1;
    const order: ReadonlyArray<ItemKey> =
      revision === 0 ? ["command", "reasoning", "todo"] : ["reasoning", "command", "todo"];
    const events = [
      ...order.map((key) => itemEvent(threadId, now, key, revision, final)),
      messageEvent(threadId, now, revision, final),
      // The tool node first appears after the root, then streams before it.
      ...(revision === 0
        ? ["root" as const, "tool" as const]
        : ["tool" as const, "root" as const]
      ).map((key) => nodeEvent(threadId, now, key, revision, final)),
      ...(revision < PROVIDER_THREAD_SWITCHES.length
        ? [providerThreadEvent(threadId, now, PROVIDER_THREAD_SWITCHES[revision]!, revision)]
        : []),
      ...(revision < 2 ? [subagentItemEvent(threadId, now, revision)] : []),
    ];
    writes.push(...(yield* sink.write({ events })));
    // Commanded rows answer command-result replay, so the fold must leave this entity alone.
    writes.push(
      ...(yield* sink.write({
        commandId: CommandId.make(`command:fold:${threadId}:${revision}`),
        events: [itemEvent(threadId, now, "commanded", revision, final)],
      })),
    );
  }
  // The stream's newest row is a todo snapshot: folding it would lower the snapshot sequence.
  writes.push(
    ...(yield* sink.write({ events: [itemEvent(threadId, now, "todo", REVISIONS, true)] })),
  );
  return writes;
});

/** Applies stored events to a client projection the way client-runtime does on resume. */
function replayOnClient(
  base: OrchestrationV2ThreadProjection,
  events: ReadonlyArray<OrchestrationV2StoredEvent>,
) {
  let projection: OrchestrationV2ThreadProjection | null = base;
  let latestLocalTurnOrdinal: number | null = null;
  for (const stored of events) {
    projection = applyOrchestrationV2ProjectionEvent(projection, stored.event, {
      partialTimeline: true,
      latestLocalTurnOrdinal,
    });
    if (stored.event.type === "turn-item.updated") {
      latestLocalTurnOrdinal = Math.max(latestLocalTurnOrdinal ?? 0, stored.event.payload.ordinal);
    }
  }
  return projection!;
}

function emptyClient(projection: OrchestrationV2ThreadProjection): OrchestrationV2ThreadProjection {
  return {
    ...projection,
    messages: [],
    turnItems: [],
    visibleTurnItems: [],
    nodes: [],
    providerThreads: [],
  };
}

const everything = Number.MAX_SAFE_INTEGER;

it.effect("folds settled snapshots into their oldest row and rebuilds the same projection", () =>
  Effect.gen(function* () {
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:snapshot-fold");
    const writes = yield* seedThread(threadId, now);
    const before = yield* projections.getThreadProjection(threadId);
    const beforeSnapshot = yield* projections.getThreadSnapshot(threadId);
    const highWater = yield* eventStore.latestSequence();
    // A later thread folds rows above this thread's head; that must not touch this thread's resume.
    const laterThreadId = ThreadId.make("thread:snapshot-fold-later");
    const laterWrites = yield* seedThread(laterThreadId, now);

    // Doctor/background compaction first, exactly as the scheduled pass runs it.
    yield* maintenance.compactEventStore();
    const folded = yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });
    const after = yield* eventStore.read({ threadId }).pipe(Stream.runCollect);

    const rowsFor = (eventId: (revision: number) => string) =>
      after.filter((stored) =>
        Array.from({ length: REVISIONS + 1 }, (_, revision) => eventId(revision)).includes(
          stored.event.id,
        ),
      );
    const finalWrite = (eventId: string) => writes.find((stored) => stored.event.id === eventId)!;
    // Folded entities keep exactly their oldest row, now carrying the newest body.
    for (const key of ["command", "reasoning", "node-root", "node-tool"] as const) {
      const rows = rowsFor((revision) => `event:fold:${threadId}:${key}:${revision}`);
      assert.lengthOf(rows, 1, key);
      assert.equal(rows[0]!.sequence, finalWrite(`event:fold:${threadId}:${key}:0`).sequence);
      assert.deepEqual(
        rows[0]!.event.payload,
        finalWrite(`event:fold:${threadId}:${key}:${REVISIONS - 1}`).event.payload,
      );
    }
    const messageRows = rowsFor((revision) => `event:fold:${threadId}:message:${revision}`);
    assert.lengthOf(messageRows, 1);
    assert.deepEqual(
      messageRows[0]!.event.payload,
      finalWrite(`event:fold:${threadId}:message:${REVISIONS - 1}`).event.payload,
    );
    // Commanded and subagent entities are untouched; the newest-row entity keeps first + latest.
    assert.lengthOf(
      rowsFor((revision) => `event:fold:${threadId}:commanded:${revision}`),
      REVISIONS,
    );
    assert.lengthOf(
      rowsFor((revision) => `event:fold:${threadId}:subagent-item:${revision}`),
      2,
    );
    assert.lengthOf(
      rowsFor((revision) => `event:fold:${threadId}:todo:${revision}`),
      2,
    );
    // Provider threads are never folded: their order decides the active provider thread.
    for (const key of ["a", "b"] as const) {
      assert.lengthOf(
        rowsFor((revision) => `event:fold:${threadId}:provider-thread-${key}:${revision}`),
        PROVIDER_THREAD_SWITCHES.filter((switched) => switched === key).length,
        key,
      );
    }
    // Per thread: command, reasoning, message and both nodes.
    assert.equal(folded.foldedEntityCount, 10);
    assert.isAtLeast(folded.transactionCount, 2);

    // Sequence bounds and the snapshot cursor do not move.
    assert.equal(yield* eventStore.latestSequence(), laterWrites.at(-1)!.sequence);
    assert.equal(
      (yield* projections.getThreadSnapshot(threadId)).snapshotSequence,
      beforeSnapshot.snapshotSequence,
    );

    // Each thread's watermark is its highest folded-away sequence. There is no global watermark.
    const watermarkOf = (name: string) =>
      sql<{ readonly last_sequence: number }>`
        SELECT last_sequence FROM orchestration_v2_projection_metadata
        WHERE projection_name = ${name}
      `.pipe(Effect.map((rows) => rows[0]?.last_sequence));
    const watermark = (yield* watermarkOf(
      OrchestrationEventStore.snapshotFoldThreadMetadataName(threadId),
    ))!;
    const deleted = writes
      .filter((stored) => !after.some((kept) => kept.sequence === stored.sequence))
      .map((stored) => stored.sequence);
    assert.equal(watermark, Math.max(...deleted));
    const laterWatermark = (yield* watermarkOf(
      OrchestrationEventStore.snapshotFoldThreadMetadataName(laterThreadId),
    ))!;
    assert.isAbove(laterWatermark, beforeSnapshot.snapshotSequence);
    assert.isUndefined(yield* watermarkOf(OrchestrationEventStore.SNAPSHOT_FOLD_METADATA_NAME));

    // Rebuild from the folded log equals the live projection built while appending.
    assert.equal(
      before.thread.activeProviderThreadId,
      ProviderThreadId.make(`provider-thread:fold:${threadId}:a`),
    );
    assert.isTrue((yield* maintenance.verify).valid);
    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.deepEqual(yield* projections.getThreadProjection(threadId), before);

    // A client replaying from the start ends in the same state, in the same insertion order, as
    // one replaying the unfolded log: every field, not only the transcript.
    const client = replayOnClient(emptyClient(before), after);
    assert.deepEqual(client, replayOnClient(emptyClient(before), writes));
    assert.deepEqual(client.turnItems, before.turnItems);
    assert.deepEqual(client.visibleTurnItems, before.visibleTurnItems);
    assert.deepEqual(client.messages, before.messages);
    assert.deepEqual(client.nodes, before.nodes);
    assert.deepEqual(client.providerThreads, before.providerThreads);

    // Resume stats flag every cursor below the watermark, and only those.
    const stats = (afterSequence: number) =>
      applicationEvents.getAgentReplayStats({
        threadId,
        afterSequence,
        throughSequence: highWater,
        maxEvents: 128,
      });
    assert.isTrue((yield* stats(0)).crossesSnapshotFold);
    assert.isTrue((yield* stats(watermark - 1)).crossesSnapshotFold);
    assert.isFalse((yield* stats(watermark)).crossesSnapshotFold);
    // Opening this thread resumes from its snapshot cursor, which is below the later thread's
    // folds: thread resume must still replay.
    assert.isFalse((yield* stats(beforeSnapshot.snapshotSequence)).crossesSnapshotFold);
    // The post-read re-check agrees with the stats.
    assert.isTrue(yield* applicationEvents.crossesSnapshotFold({ threadId, afterSequence: 0 }));
    assert.isFalse(
      yield* applicationEvents.crossesSnapshotFold({ threadId, afterSequence: watermark }),
    );

    // A second pass finds nothing new and keeps the watermark.
    const second = yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });
    assert.equal(second.foldedEntityCount, 0);
    assert.equal(second.deletedEventCount, 0);
    assert.equal(
      yield* watermarkOf(OrchestrationEventStore.snapshotFoldThreadMetadataName(threadId)),
      watermark,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("resumes every old cursor to the server's state: replay or snapshot fallback", () =>
  Effect.gen(function* () {
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:snapshot-fold-resume");
    const writes = yield* seedThread(threadId, now);
    const before = yield* projections.getThreadProjection(threadId);
    const highWater = yield* eventStore.latestSequence();
    yield* maintenance.compactEventStore();
    yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });

    // Every cursor a client could hold: before the thread, at each write, at the head.
    let replayed = 0;
    let fellBack = 0;
    for (const cursor of [0, ...writes.map((stored) => stored.sequence)]) {
      const stats = yield* applicationEvents.getAgentReplayStats({
        threadId,
        afterSequence: cursor,
        throughSequence: highWater,
        maxEvents: 128,
      });
      if (stats.crossesSnapshotFold) {
        // ws.ts sends a snapshot here; the snapshot is the projection itself.
        fellBack += 1;
        continue;
      }
      replayed += 1;
      // The client already holds everything through its cursor, from the original stream.
      const held = replayOnClient(
        emptyClient(before),
        writes.filter((stored) => stored.sequence <= cursor),
      );
      const replay = yield* eventStore
        .read({ threadId, afterSequence: cursor, throughSequence: highWater })
        .pipe(Stream.runCollect);
      const client = replayOnClient(held, replay);
      assert.deepEqual(client.turnItems, before.turnItems, `cursor ${cursor}`);
      assert.deepEqual(client.visibleTurnItems, before.visibleTurnItems, `cursor ${cursor}`);
      assert.deepEqual(client.messages, before.messages, `cursor ${cursor}`);
      assert.deepEqual(client.nodes, before.nodes, `cursor ${cursor}`);
      assert.deepEqual(client.providerThreads, before.providerThreads, `cursor ${cursor}`);
    }
    assert.isAbove(replayed, 0);
    assert.isAbove(fellBack, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("replays a missed turn, and never folds entities newer than the settle cutoff", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:snapshot-fold-missed-turn");
    const writes = [...(yield* seedThread(threadId, now))];
    // An earlier pass folded the settled history.
    yield* maintenance.compactEventStore();
    yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });

    // A client is current, disconnects, and misses a whole new turn.
    const cursor = yield* eventStore.latestSequence();
    const held = yield* projections.getThreadProjection(threadId);
    const later = DateTime.add(now, { hours: 2 });
    // The background pass samples the head before the client's missed turn starts.
    for (let revision = 0; revision < REVISIONS; revision += 1) {
      const final = revision === REVISIONS - 1;
      writes.push(
        ...(yield* sink.write({
          events: [
            itemEvent(threadId, later, "late", revision, final),
            messageEvent(threadId, later, REVISIONS + revision, final),
          ],
        })),
      );
    }
    writes.push(
      ...(yield* sink.write({ events: [itemEvent(threadId, later, "todo", REVISIONS + 1, true)] })),
    );
    const head = yield* eventStore.latestSequence();
    const expected = yield* projections.getThreadProjection(threadId);

    // The background pass runs while the client is away; the new turn is above its sample.
    const pass = yield* maintenance.foldSupersededSnapshots({ settledThrough: cursor });
    assert.equal(pass.foldedEntityCount, 0);
    assert.equal(pass.deletedEventCount, 0);

    // The cursor is above the old watermark, so the client replays the turn event by event.
    const stats = yield* applicationEvents.getAgentReplayStats({
      threadId,
      afterSequence: cursor,
      throughSequence: head,
      maxEvents: 128,
    });
    assert.isFalse(stats.crossesSnapshotFold);
    const replay = yield* eventStore
      .read({ threadId, afterSequence: cursor, throughSequence: head })
      .pipe(Stream.runCollect);
    assert.deepEqual(
      replay.map((stored) => stored.sequence),
      writes.filter((stored) => stored.sequence > cursor).map((stored) => stored.sequence),
    );
    const client = replayOnClient(held, replay);
    assert.deepEqual(client.turnItems, expected.turnItems);
    assert.deepEqual(client.visibleTurnItems, expected.visibleTurnItems);
    assert.deepEqual(client.messages, expected.messages);

    // Once that turn settles a later pass folds it, and the same cursor falls back to a snapshot.
    const settled = yield* maintenance.foldSupersededSnapshots({ settledThrough: head });
    assert.isAbove(settled.deletedEventCount, 0);
    assert.isTrue(
      (yield* applicationEvents.getAgentReplayStats({
        threadId,
        afterSequence: cursor,
        throughSequence: head,
        maxEvents: 128,
      })).crossesSnapshotFold,
    );
    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.deepEqual(yield* projections.getThreadProjection(threadId), expected);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps the last activity event so a replaying client keeps the thread's updatedAt", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const eventStore = yield* EventStore.EventStoreV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:snapshot-fold-visited");
    const message = (key: "m" | "n", revision: number, second: number) => {
      const at = DateTime.add(now, { seconds: second });
      return {
        id: EventId.make(`event:fold:${threadId}:${key}:${revision}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          id: MessageId.make(`message:fold:${threadId}:${key}`),
          threadId,
          runId: null,
          nodeId: null,
          role: "assistant",
          text: `${key} ${revision}`,
          attachments: [],
          streaming: revision === 0,
          createdBy: "agent",
          creationSource: "provider",
          createdAt: now,
          updatedAt: at,
        },
      } satisfies OrchestrationV2DomainEvent;
    };
    const writes = [
      ...(yield* sink.write({
        events: [
          {
            id: EventId.make(`event:fold:thread:${threadId}`),
            type: "thread.created",
            threadId,
            providerInstanceId,
            occurredAt: now,
            payload: makeThread(threadId, now),
          },
        ],
      })),
    ];
    for (const [key, revision, second] of [
      ["m", 0, 1],
      ["m", 1, 2],
      ["n", 0, 3],
      ["n", 1, 4],
    ] as const) {
      writes.push(...(yield* sink.write({ events: [message(key, revision, second)] })));
    }
    // Visiting is not activity: replay keeps updatedAt from n's last row, so n must not fold.
    writes.push(
      ...(yield* sink.write({
        events: [
          {
            id: EventId.make(`event:fold:${threadId}:visited`),
            type: "thread.visited",
            threadId,
            occurredAt: DateTime.add(now, { seconds: 5 }),
            payload: {
              ...makeThread(threadId, now),
              lastVisitedAt: DateTime.add(now, { seconds: 5 }),
            },
          },
        ],
      })),
    );
    const before = yield* projections.getThreadProjection(threadId);

    const folded = yield* maintenance.foldSupersededSnapshots({ settledThrough: everything });
    assert.equal(folded.foldedEntityCount, 1);
    const after = yield* eventStore.read({ threadId }).pipe(Stream.runCollect);
    assert.deepEqual(
      after.map((stored) => stored.event.id),
      writes
        .filter((stored) => stored.event.id !== `event:fold:${threadId}:m:1`)
        .map((stored) => stored.event.id),
    );
    const client = replayOnClient(emptyClient(before), after);
    assert.deepEqual(client, replayOnClient(emptyClient(before), writes));
    assert.deepEqual(client.updatedAt, DateTime.add(now, { seconds: 4 }));
    assert.isTrue((yield* maintenance.rebuild).valid);
    assert.deepEqual(yield* projections.getThreadProjection(threadId), before);
  }).pipe(Effect.provide(layerTest)),
);
