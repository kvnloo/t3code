# Snapshot fold (experimental)

Behind `T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD=1`, default off. On a database the fold has never touched, leaving the variable unset gives exactly the old behavior: no row is folded, no watermark exists, and resume decisions are unchanged. Once a fold has run, see [One-way door](#one-way-door).

## Why

Most of the event log is whole-entity snapshots. `turn-item.updated`, `node.updated` and `message.updated` each carry an entity's full state, so only the newest row per entity is information. Compaction (`compactEventStore`, run by `t3 doctor` and the six-hourly background pass) already deletes the middle rows, but keeps the **first** row per entity.

It keeps the first row because clients and the projector insert an entity at its first appearance (`upsertEntity` in `packages/client-runtime/src/state/orchestrationV2Projection.ts`). Deleting that row would move the entity to its last appearance on replay and on rebuild.

## What the fold does

`ProjectionMaintenance.foldSupersededSnapshots` runs after compaction in the background pass (`persistence/DatabaseStorage.ts`). For every entity of those three types it moves the newest body into the **oldest** row and deletes the newer rows. One row per entity remains, at the original insertion point, with the final state:

- Replay from before that row and `rebuild` both insert the entity at the same place and end in the same state. This holds only because each folded type projects onto its own entity and nothing else, on the server (SQL and in-memory apply) and on the client.
- Projections are not touched. They already hold the final state.
- Only `payload_json` moves. The surviving row keeps its own `event_id`, `occurred_at` and `metadata_json` (`runId`, `nodeId`, `rawEventId`, …), so `occurred_at` stays monotonic with `sequence`. No reader combines a replayed row's envelope with its body for these types today. A new reader must not assume they belong to the same write.

`provider-thread.updated` is **not** folded. Applying one also sets `thread.activeProviderThreadId`, so the order of provider threads, and of `thread.*` events that carry the whole thread, decides the result. Folding A's newest body back to A's first row, before a later B, makes rebuild pick B.

The fold skips an entity when:

- any of its rows has a `command_id`, because command-result replay (`readByCommandId`) returns those rows verbatim;
- it is a `subagent` turn item, because those rows anchor `promptSequence` prompts;
- its newest row is at or after the thread's last _activity_ event (any event except `thread.visited`, `thread.tags-updated`, `thread.marked-unread` and `thread.pull-request-link-updated`). Some replay keeps the previous `updatedAt` after each of those: the client and in-memory apply skip the bump for the first three, and the server (SQL and in-memory apply, so `rebuild`) re-applies the current thread row for a PR link sync. Deleting the row that set `updatedAt` would move it back. Every other `thread.*` event carries its own `updatedAt`. This rule also covers the stream's newest row, whose removal would lower the thread's snapshot sequence and reuse its `stream_version`;
- it has a row above the pass's settle sequence. The pass samples the head sequence before compaction and folds only after 10 minutes on the monotonic clock, so a wall-clock jump cannot make a fresh row look settled. A reader that drains at once from a fresh cursor (task waits, guest share, remote delegation, command output) is therefore never inside a fold. A reader can still start reading long after it took its cursor: the RPC server starts a subscription's live tail only after the client acks the snapshot or replay chunk, and a suspended client may not ack for longer than the settle age. The tail's own check (below) covers that.

Each thread is folded in transactions of at most 64 entities, with the background pass's 10 % duty pacing between them, so a large thread never holds the SQLite writer for its whole length.

## The replay watermark

A client whose cursor lies between an entity's first and last row would miss the final state, because that state now lives behind its cursor. Each fold transaction therefore raises the thread's watermark in `orchestration_v2_projection_metadata` (`event-snapshot-fold:<threadId>`) to its highest deleted sequence.

- `OrchestrationEventStore.getAgentReplayStats` reports `crossesSnapshotFold` for a cursor below the thread's watermark, and `subscribeThread` (`ws.ts`) sends a snapshot instead of a replay.
- The stats check and the replay read are separate statements, and a fold can commit between them. `subscribeThread` therefore checks `crossesSnapshotFold` again after reading the replay. A fold that committed before that check is caught, and one that commits after it did not change what was read.
- The live tail catches up from the database in pages (`EventSink` `catchUp`) from the snapshot or replay cursor. Every thread-scoped page read is followed by the same watermark check against that page's start cursor, and a crossed watermark fails the stream with `EventSinkStreamError` (surfaced as the retryable `OrchestrationV2GetThreadProjectionError`). The client retries from the cursor it holds, which now crosses the watermark, so it gets a snapshot. Live events from the PubSub are never read from the database and need no check. Unscoped streams (no thread id) are not checked; their readers drain from fresh cursors.

That snapshot path already serves gaps of more than 128 events, so clients need no change. This covers web and desktop IndexedDB caches and mobile SQLite caches.

The watermark is per thread. An idle thread's snapshot cursor is its newest event, which stays below folds made later in other threads; a global watermark sent every reopened old thread its snapshot a second time.

Shell resume has no watermark. Shell replay keeps only each event's thread id and sequence and re-reads that thread's projection, and the fold never deletes a thread's newest event, so every thread that changed after a cursor still has an event above it.

The pass prunes watermarks of threads that have no events left.

## One-way door

Folded rows are deleted. They cannot be restored.

- **Flag off after a fold:** safe. Resume keeps honoring existing watermarks whatever the flag says; only new folds stop.
- **Downgrade to a build without the watermark check:** not safe for clients whose cached cursor lies inside a folded range. They replay and keep a stale entity, for example a streaming message that never finishes, until that entity changes again. Leaving such a build therefore needs the clients' thread caches cleared (sign out and back in, or clear site data; reinstall on mobile). Rebuilds on that build are still correct.

## What is unchanged

- **Projections and their rowid order.** Rebuild from a folded log equals the rebuild from a compacted log, and differs from the live tables in exactly the same rows. The opt-in `SnapshotFold.seed.test.ts` checks both on a real seed copy.
- **`t3_thread_read` positions** (`orchestration_v2_turn_item_positions`, rebuilt from the surviving rows' ordinals) and checkpoint events, which are not folded.
- **Fork and handoff paths.** They read projections, not events.
- **`t3 doctor`.** It does not fold.

## Where the bytes go

The fold deletes rows in place. New databases are created with `auto_vacuum` INCREMENTAL (`persistence/Sqlite.ts`), and `t3 doctor` converts older ones; on those, `reclaim` returns the freed pages to the filesystem at up to 1,024 pages a minute. A database created before that and never run through doctor has `auto_vacuum` NONE. There the freed pages stay in the file as freelist: later writes reuse them and the Storage page shows them as reclaimable, but the file does not shrink until `t3 doctor` runs VACUUM. The fold cannot switch `auto_vacuum` itself, because that needs a full VACUUM, which doctor refuses to run while a server has the database open. On such a database the file-size saving lands after doctor; until then it is growth headroom.

`T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD_SETTLE_MS` overrides the 10-minute settle age. It exists so a benchmark can run a pass inside a measured server boot; do not set it otherwise.

## Proof

- `apps/server/src/orchestration-v2/SnapshotFold.test.ts` covers fold shape, rebuild equivalence with the live projection, whole-projection client replay (including nodes, provider threads and `updatedAt`), every resume cursor (replay or fallback), the activity-tail rule, and missed-turn replay plus the settle cutoff.
- `SnapshotFold.review.test.ts` holds the review repros: the provider-thread switch-back under rebuild, and a fold injected between the resume stats check and the replay read of the real `subscribeThread`.
- `SnapshotFold.review2.test.ts` holds the round-2 repros: rebuild keeps `thread.updatedAt` when a PR link sync follows a folded message, and a fold that commits before the live tail starts makes the tail fail, after which the client's retry from its cursor gets a snapshot with the final body.
- `SnapshotFold.seed.test.ts` (opt-in, `POH_FOLD_SEED=<copy>`) checks the same on a real seed copy.
- The provider-owned-history experiment P2/02 holds the A/B numbers.
