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
The PoH bench records server storage writes per simulated turn to watch this
(`bench/poh`, `turn.sim.server_write.bytes`).
