# PoH P2/02b: projection rebuild divergence

Fork-only experiment branch `exp/poh/02b-rebuild-divergence`, cut from `origin/main` at
`30b9c4a956a6c595fda5c8b2c439a6aaebc861b0`.

Finding: rebuilding projections from the event log on a copy of real data differs from the live
tables in five tables, and none of the differences is a bug on this SHA.

- `nodes.checkpoint_scope_id` / `runtime_request_id`, `provider_sessions.model`,
  `checkpoints.parent_checkpoint_id`, `context_transfers.source/target_provider(_instance_id)`:
  dead denormalized columns. The live rows were written by v0.1.2, whose projector still filled
  them; upstream PR 26238 removed those writes and every reader. The same value stays in `payload_json`.
- `turn_item_positions`: 2 live rows are position reservations for streaming reasoning items the
  assistant streaming filter held back in runs that then failed or were cancelled
  (`RunExecutionService.ts` reserve-on-hold). No event exists for them, so rebuild cannot recreate
  them. Only the allocator reads the table, and item ordinals are unchanged.

`apps/server/src/orchestration-v2/ProjectionRebuildDivergence.test.ts` pins the second case.
Full write-up: `t3code-factory/poh/02b-rebuild-divergence.md` in the owner's operations data.
