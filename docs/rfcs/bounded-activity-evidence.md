# Bounded activity evidence — downstream R&D

Status: fork-only research. Do not promote upstream until a real T3 workload proves that full dropped evidence is needed.

## TL;DR

Upstream `#12758` / PR `#14048` correctly fixes the immediate OOM by stopping full Codex file-change diffs from entering durable activity rows.

The reusable RLM lesson is narrower:

> Keep the activity row small. If bulky evidence is actually useful later, store a scoped locator and fetch/reconstruct it only on demand.

Do **not** add a generic sidecar store just because we can.

## Existing T3 carriers

Prefer existing ownership boundaries:

- `ActivityPayloadProjection` owns bounded renderable activity data.
- `CheckpointStore.diffCheckpoints()` can reconstruct workspace diffs from revision-bound checkpoint refs.
- `attachmentStore` already provides thread-scoped filesystem objects and safe IDs.
- orchestration/projection rows remain the small durable index.

## Candidate contract

```text
native provider payload
   |
   +-> bounded activity projection -> SQLite / ordinary hydration
   |
   +-> evidence identity
          |
          +-> reconstructible -> checkpoint/diff locator
          |
          +-> non-reconstructible -> content-addressed thread-scoped sidecar
```

A bounded activity may optionally carry:

```ts
{
  evidenceRef: {
    kind: "checkpoint_diff" | "sidecar",
    revision: "...",
    sha256: "...",
    bytes: 49359322
  },
  preview: "...",
  omittedBytes: 49358_000
}
```

## Invariants

1. Full evidence never rides normal thread hydration.
2. No large blob is duplicated across `orchestration_events` and `projection_thread_activities`.
3. Locator scope includes thread/workspace authority; identical content hashes do not authorize cross-thread access.
4. Reconstruct from existing checkpoints when possible instead of duplicating bytes.
5. Missing/expired evidence does not make the activity row unreadable.
6. Sidecars have explicit retention/GC tied to thread lifecycle.
7. Full evidence retrieval is explicit and user/agent initiated.
8. The small projection is sufficient for the current UI.

## First experiment

Fixtures:

- one ~50 MiB Codex `fileChange` payload;
- one large non-reconstructible MCP text result.

Measure:

| Metric | current bounded projection | locator experiment |
| --- | ---: | ---: |
| SQLite bytes written | | |
| heap during thread hydration | | |
| normal thread-detail response bytes | | |
| explicit full-evidence reopen latency | | |
| retained sidecar bytes after thread delete | | |

## Decision rule

If no real T3 workflow needs the full evidence after #14048, stop here and keep only the bounded projection.

If one does, implement the **smallest repo-native locator** for that evidence class first. Do not introduce an RLM-specific runtime or a generic blob service before the need exists.

## Related

- upstream issue: pingdotgg/t3code#12758
- upstream fix: pingdotgg/t3code#14048
- downstream source idea: RLM-style spill -> locator -> bounded read/search
