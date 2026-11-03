# SQLite page size (experimental)

`T3CODE_EXPERIMENTAL_PAGE_SIZE` (default unset) picks the SQLite page size for `statev2.sqlite`.
Valid values are powers of two from 512 to 65536. Anything else counts as unset.

## Why

With the default 4 KiB pages, an `orchestration_events` row is usually 1–3 KiB (payload, a ~300 B
event id and a ~330 B `metadata_json`), so most leaf pages hold one row and leave the rest empty.
On a real 618 MiB database, 132 MiB (21%) were unused bytes inside pages. 82 MiB of that was in the
event table alone. With 16 KiB pages a leaf holds five to seven rows, and slack drops to 43 MiB.

## Where it applies

- **New databases** take the size before their first table is created (`persistence/Sqlite.ts`).
  An existing database keeps its page size when the server opens it.
- **`t3 doctor --fix`** rewrites an existing database at the opted-in size
  (`persistence/DatabaseMaintenance.ts` `compact`). A WAL database keeps its page size through
  `VACUUM`, so doctor switches to `journal_mode = DELETE` for the `VACUUM` and back to WAL after.
  Doctor already holds the exclusive lock that refuses to run while a server has the file open.
  When the size differs, doctor offers and recommends the repair even if nothing else is reclaimable.

Nothing else reads the flag. Queries, schema, ids and everything on the wire are unchanged. With
the flag unset, both paths are unchanged.

## Cost

Each changed page is written whole, so a WAL commit writes 16 KiB frames instead of 4 KiB ones.
A simulated turn makes 52 commits. Each commit rewrites the right-edge leaf of `orchestration_events`
and of each of its indexes, plus single-row pages such as `sqlite_sequence`, the projection metadata
row and the thread row. That is about 29 frames per commit at 4 KiB and 22 at 16 KiB. Bigger pages
barely cut the frame count, so WAL bytes grow almost in step with the page size:

| page size | SQLite writes per turn | of which WAL | checkpoint copy-back |
| --------- | ---------------------- | ------------ | -------------------- |
| 4 KiB     | 7.1 MiB                | 6.0 MiB      | 1.2 MiB              |
| 8 KiB     | 11.8 MiB               | 10.1 MiB     | 2.0 MiB              |
| 16 KiB    | 21.9 MiB               | 18.2 MiB     | 3.6 MiB              |

Checkpoint settings cannot close the gap, because they only change the copy-back part:

- Checkpointing more often (`T3CODE_EXPERIMENTAL_CHECKPOINT_FRAMES`) copies the same hot pages back
  more times.
- A smaller `journal_size_limit` (`T3CODE_EXPERIMENTAL_JOURNAL_SIZE_LIMIT`) truncates the WAL without
  writing fewer bytes.

Both knobs are experimental and default off. The fix that would help is fewer commits per turn.

The PoH bench measures this with an `LD_PRELOAD` write tap (`bench/poh/iotap.c`, `--iotap`). The tap
reports WAL frames, commits and copy-back per turn. `/proc` `write_bytes` is too noisy for this on
btrfs.
