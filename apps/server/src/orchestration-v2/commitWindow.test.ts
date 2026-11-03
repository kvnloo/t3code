import { assert, it } from "@effect/vitest";
import {
  EventId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { afterEach } from "vite-plus/test";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { deferredEntityKey, experimentalCommitWindowMs } from "./commitWindow.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const WINDOW_ENV = "T3CODE_EXPERIMENTAL_COMMIT_WINDOW_MS";
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

// The window is read when the sink layer is built, so each test builds a fresh one.
const makeLayer = () => {
  const database = SqlitePersistence.layerMemory;
  const stores = Layer.mergeAll(
    database,
    EventStore.layer.pipe(Layer.provideMerge(database)),
    ProjectionStore.layer.pipe(Layer.provideMerge(database)),
  );
  return Layer.fresh(EventSink.layer.pipe(Layer.provide(stores)));
};

const withWindow = (ms: string | undefined) =>
  Effect.sync(() => {
    if (ms === undefined) delete process.env[WINDOW_ENV];
    else process.env[WINDOW_ENV] = ms;
  });

afterEach(() => {
  delete process.env[WINDOW_ENV];
});

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: `Thread ${threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const setup = (name: string) =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make(`thread:commit-window-${name}`);
    const thread = makeThread(threadId, now);
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:${name}:created`),
          type: "thread.created",
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: thread,
        },
      ],
    });
    const update = (label: string): OrchestrationV2DomainEvent => ({
      id: EventId.make(`event:${name}:${label}`),
      type: "thread.metadata-updated",
      threadId,
      providerInstanceId,
      occurredAt: now,
      payload: { ...thread, title: label },
    });
    const writeDeferred = sink.writeDeferred;
    const flushDeferred = sink.flushDeferred;
    if (writeDeferred === undefined || flushDeferred === undefined) {
      return yield* Effect.die("The commit window is on, so the sink must offer deferred writes.");
    }
    const readIds = (afterSequence = 0) =>
      sink.latestSequence({ threadId }).pipe(
        Effect.flatMap((through) =>
          through <= afterSequence
            ? Effect.succeed([] as Array<string>)
            : sink.stream({ threadId, afterSequence }).pipe(
                Stream.takeUntil((stored) => stored.sequence >= through),
                Stream.map((stored) => `${stored.sequence}:${stored.event.id}`),
                Stream.runCollect,
                Effect.map((chunk) => Array.from(chunk)),
              ),
        ),
      );
    return { sink, threadId, update, writeDeferred, flushDeferred, readIds };
  });

it("reads the window from the environment, off unless a positive integer", () => {
  for (const [raw, expected] of [
    [undefined, 0],
    ["", 0],
    ["0", 0],
    ["-5", 0],
    ["2.5", 0],
    ["abc", 0],
    ["25", 25],
    ["5000", 1000],
  ] as const) {
    if (raw === undefined) delete process.env[WINDOW_ENV];
    else process.env[WINDOW_ENV] = raw;
    assert.equal(experimentalCommitWindowMs(), expected, `raw=${String(raw)}`);
  }
  assert.equal(
    deferredEntityKey({ type: "plan.updated", plan: { id: "plan-1" } } as never),
    "plan:plan-1",
  );
});

it.effect("offers no deferred writes when the window is off", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    assert.isUndefined(sink.writeDeferred);
    assert.isUndefined(sink.flushDeferred);
  }).pipe(Effect.provide(makeLayer()), Effect.ensuring(withWindow(undefined))),
);

it.effect("commits queued events together after the window, in arrival order", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, readIds } = yield* setup("window");
    const before = yield* sink.latestSequence({ threadId });
    for (const label of ["a", "b", "c"]) {
      yield* writeDeferred({ events: [update(label)], entityKeys: [] });
    }
    // Nothing is committed or published inside the window.
    assert.equal(yield* sink.latestSequence({ threadId }), before);
    yield* TestClock.adjust("49 millis");
    assert.equal(yield* sink.latestSequence({ threadId }), before);
    yield* TestClock.adjust("1 millis");
    assert.deepEqual(yield* readIds(before), [
      `${before + 1}:event:window:a`,
      `${before + 2}:event:window:b`,
      `${before + 3}:event:window:c`,
    ]);
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("commits the queue before any other write, so sequences follow arrival", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, readIds } = yield* setup("ordering");
    const before = yield* sink.latestSequence({ threadId });
    yield* writeDeferred({ events: [update("queued-1")], entityKeys: [] });
    yield* writeDeferred({ events: [update("queued-2")], entityKeys: [] });
    const direct = yield* sink.write({ events: [update("direct")] });
    assert.equal(direct[0]?.sequence, before + 3);
    assert.deepEqual(yield* readIds(before), [
      `${before + 1}:event:ordering:queued-1`,
      `${before + 2}:event:ordering:queued-2`,
      `${before + 3}:event:ordering:direct`,
    ]);
    // The window timer finds an empty queue and commits nothing more.
    yield* TestClock.adjust("50 millis");
    assert.equal(yield* sink.latestSequence({ threadId }), before + 3);
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("flushes for a pending entity key, and only then", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, flushDeferred } = yield* setup("entity");
    const before = yield* sink.latestSequence({ threadId });
    yield* writeDeferred({ events: [update("node")], entityKeys: ["node:n1"] });
    yield* flushDeferred({ threadId, entityKeys: ["node:other"] });
    yield* flushDeferred({ threadId, entityKeys: [] });
    assert.equal(yield* sink.latestSequence({ threadId }), before);
    yield* flushDeferred({ threadId, entityKeys: ["node:n1"] });
    assert.equal(yield* sink.latestSequence({ threadId }), before + 1);
    yield* writeDeferred({ events: [update("again")], entityKeys: [] });
    yield* flushDeferred({ threadId, entityKeys: "all" });
    assert.equal(yield* sink.latestSequence({ threadId }), before + 2);
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("keeps queued events when the writer is interrupted mid-window", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, readIds } = yield* setup("abort");
    const before = yield* sink.latestSequence({ threadId });
    const writer = yield* Effect.gen(function* () {
      yield* writeDeferred({ events: [update("before-abort")], entityKeys: [] });
      return yield* Effect.never;
    }).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(writer);
    yield* TestClock.adjust("50 millis");
    assert.deepEqual(yield* readIds(before), [`${before + 1}:event:abort:before-abort`]);
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("lets a subscriber resume mid-batch without gaps or duplicates", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, readIds } = yield* setup("replay");
    const before = yield* sink.latestSequence({ threadId });
    const live = yield* sink.stream({ threadId, afterSequence: before }).pipe(
      Stream.take(4),
      Stream.map((stored) => stored.sequence),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    for (const label of ["1", "2", "3", "4"]) {
      yield* writeDeferred({ events: [update(label)], entityKeys: [] });
    }
    yield* TestClock.adjust("50 millis");
    assert.deepEqual(Array.from(yield* Fiber.join(live)), [
      before + 1,
      before + 2,
      before + 3,
      before + 4,
    ]);
    // A reconnect from the middle of the batch replays exactly the rest.
    assert.deepEqual(yield* readIds(before + 2), [
      `${before + 3}:event:replay:3`,
      `${before + 4}:event:replay:4`,
    ]);
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("reports a failed batch to the thread's next deferred call", () =>
  Effect.gen(function* () {
    const { sink, threadId, update, writeDeferred, flushDeferred } = yield* setup("failure");
    const before = yield* sink.latestSequence({ threadId });
    // A duplicate event id violates the event log's unique key, so the whole batch rolls back.
    yield* writeDeferred({ events: [update("dup")], entityKeys: [] });
    yield* writeDeferred({ events: [update("dup")], entityKeys: [] });
    yield* TestClock.adjust("50 millis");
    assert.equal(yield* sink.latestSequence({ threadId }), before);
    const failed = yield* flushDeferred({ threadId, entityKeys: [] }).pipe(Effect.flip);
    assert.equal(failed._tag, "EventSinkWriteError");
    // Reported once; the thread can write again.
    yield* flushDeferred({ threadId, entityKeys: [] });
  }).pipe(
    Effect.provide(Layer.unwrap(withWindow("50").pipe(Effect.as(makeLayer())))),
    Effect.ensuring(withWindow(undefined)),
  ),
);

it.effect("commits the queue when the sink shuts down", () =>
  Effect.gen(function* () {
    const database = SqlitePersistence.layerMemory;
    const stores = Layer.mergeAll(
      database,
      EventStore.layer.pipe(Layer.provideMerge(database)),
      ProjectionStore.layer.pipe(Layer.provideMerge(database)),
    );
    yield* withWindow("50");
    // Build the sink in an inner scope over a shared database, then close only the sink.
    const persisted = yield* Effect.gen(function* () {
      const eventStore = yield* EventStore.EventStoreV2;
      const ids = yield* Effect.scoped(
        Effect.gen(function* () {
          const { update, writeDeferred, threadId } = yield* setup("shutdown");
          yield* writeDeferred({ events: [update("at-shutdown")], entityKeys: [] });
          return threadId;
        }).pipe(Effect.provide(Layer.fresh(EventSink.layer))),
      );
      return yield* eventStore.read({ threadId: ids }).pipe(
        Stream.map((stored) => String(stored.event.id)),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
      );
    }).pipe(Effect.provide(stores));
    assert.deepEqual(persisted, ["event:shutdown:created", "event:shutdown:at-shutdown"]);
  }).pipe(Effect.ensuring(withWindow(undefined))),
);
