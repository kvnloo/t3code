# Snapshot fold (experimental)

Behind `T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD=1`, default off. With the variable unset the server behaves exactly as before: no row is folded, and resume decisions are unchanged.

## Why

Most of the event log is whole-entity snapshots. `turn-item.updated`, `node.updated`, `message.updated` and `provider-thread.updated` each carry an entity's full state, so only the newest row per entity is information. Compaction (`compactEventStore`, run by `t3 doctor` and the six-hourly background pass) already deletes the middle rows, but keeps the **first** row per entity, and never compacts `provider-thread.updated`.

It keeps the first row because clients and the projector insert an entity at its first appearance (`upsertEntity` in `packages/client-runtime/src/state/orchestrationV2Projection.ts`). Deleting that row would move the entity to its last appearance on replay and on rebuild.

## What the fold does

`ProjectionMaintenance.foldSupersededSnapshots` runs after compaction in the background pass (`persistence/DatabaseStorage.ts`). For every entity of those four types it moves the newest body into the **oldest** row and deletes the newer rows. One row per entity remains, at the original insertion point, with the final state:

- Replay from before that row and `rebuild` both insert the entity at the same place and end in the same state. Snapshot upserts carry no history, so applying the final body early is equivalent.
- Projections are not touched. They already hold the final state.

The fold skips an entity when:

- any of its rows has a `command_id`, because command-result replay (`readByCommandId`) returns those rows verbatim;
- it is a `subagent` turn item, because those rows anchor `promptSequence` prompts;
- its newest row is the stream's newest event, because deleting that row would lower the thread's snapshot sequence and reuse its `stream_version`;
- it has a snapshot newer than 10 minutes, so the cursors of live readers (snapshot-then-live catch-up, task waits, guest share, remote delegation) never fall inside a fold.

## The replay watermark

A client whose cursor lies between an entity's first and last row would miss the final state, because that state now lives behind its cursor. Each fold therefore raises two watermarks in `orchestration_v2_projection_metadata`: the highest deleted sequence of that thread (`event-snapshot-fold:<threadId>`) and the highest across all threads (`event-snapshot-fold`).

- `OrchestrationEventStore.getAgentReplayStats` (thread resume) reports `crossesSnapshotFold` for a cursor below the thread's watermark.
- `getReplayStats` (shell resume) reports it for a cursor below the global watermark.
- `subscribeThread` and `subscribeShell` (`ws.ts`) treat it like an over-budget replay and send a snapshot instead.

That snapshot path already serves gaps of more than 128 events, so clients need no change. This covers web and desktop IndexedDB caches and mobile SQLite caches.

Thread resume must use the thread's own watermark. An idle thread's snapshot cursor is its newest event, which stays below folds made later in other threads. With one global watermark, opening any old thread sent the full snapshot over the socket a second time; the first A/B run measured this. A fresh cursor is never below its own thread's watermark, because the fold never deletes a stream's newest row. After a fold pass, only a cursor taken inside a folded range gets one snapshot. Every other resume replays as before.

## What is unchanged

- **Projections and their rowid order.** Rebuild from a folded log equals the rebuild from a compacted log. The opt-in `SnapshotFold.seed.test.ts` checks this on a real seed copy.
- **`t3_thread_read` positions** (`orchestration_v2_turn_item_positions`, rebuilt from the surviving rows' ordinals) and checkpoint events, which are not folded.
- **Fork and handoff paths.** They read projections, not events.
- **`t3 doctor`.** It does not fold.

## Proof

- `apps/server/src/orchestration-v2/SnapshotFold.test.ts` covers fold shape, rebuild equivalence, client insertion order, every resume cursor (replay or fallback), and missed-turn replay plus the settle cutoff.
- `SnapshotFold.seed.test.ts` (opt-in, `POH_FOLD_SEED=<copy>`) checks the same on a real seed copy.
- The provider-owned-history experiment P2/02 holds the A/B numbers.
