# PoH baseline harness (`bench/poh`)

Reproducible benchmarks for the provider-owned-history (PoH) program. It boots **this worktree's
server from source** on its own loopback port, against a disposable copy of seeded real data, and
measures the costs PoH must not regress, using the same HTTP and WebSocket RPCs that the web and
mobile clients send (`packages/client-runtime`).

It is a dev tool. It is not part of any package, test suite or build.

## Setup (once per worktree)

```bash
vp i            # or: pnpm install --frozen-lockfile
mkdir -p .t3/userdata && rm -f .t3/userdata/statev2.sqlite*
# Read-only snapshot of the live DB; never open ~/.t3/userdata read-write.
node -e "new (require('node:sqlite').DatabaseSync)(process.env.HOME + '/.t3/userdata/statev2.sqlite', { readOnly: true }).exec(\"VACUUM INTO '.t3/userdata/statev2.sqlite'\")"
```

## Run

```bash
# N cold boots (+1 migration boot), W warm repeats per boot, T simulated turns per boot.
RESULTS_MD=/path/report.md LEDGER=/path/ledger.jsonl bench/poh/run.sh --runs 10 --warm 10 --turns 1 --out /path/raw/<name>
# Or the pieces:
flock "$HEAVY_LOCK" node bench/poh/bench.ts --runs 10 --warm 10 --out <dir>
node bench/poh/report.ts --in <dir> [--in <dir2>] [--md report.md] [--ledger ledger.jsonl]
node bench/poh/durable.ts <statev2.sqlite>   # durable-byte accounting only
```

`run.sh` takes the shared heavy lock (`$HEAVY_LOCK`, default
`~/.hermes/profiles/clean/cache/scratch/heavy.lock`) and prints `free -g` first. A 10-boot run takes
about 10 minutes and needs about 1 GB of free RAM and 2× the seed DB size on disk.

## Safety

- The seed is copied into `.t3/bench/home-<stamp>/userdata` (gitignored) and deleted afterwards
  (`--keep-home` keeps it). The live `~/.t3` is refused as a seed path and never opened.
- Scheduled tasks are disabled in the copy, so the bench server cannot start a real turn.
- The server runs with a sandboxed `PATH` that omits provider CLIs (claude, codex, hermes, ...), so it
  cannot resume a real provider session against the owner's projects. Simulated turns use the
  repository's free `devReplay` ACP agent (`apps/server/scripts/dev-replay-agent.ts`), which the
  server seeds because the harness passes `--dev-url`.
- The server is spawned in its own process group; the harness stops only that group.

## What each phase measures

Every boot: start server (`--base-dir <bench home>`, desktop bootstrap token exchanged at
`/oauth/token`), wait for `/.well-known/t3/environment`, wait until CPU settles, then:

| phase                   | client flow reproduced                                                                                                                                                                                                          | samples                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `boot`                  | server start to HTTP ready; idle RSS (server and process tree)                                                                                                                                                                  | 1 per boot; boot 0 also runs migrations        |
| `sidebar`               | `GET /api/orchestration/shell?omitIdleSubagents=1&omitOlderSettled=1`, then `orchestration.subscribeShell {afterSequence, requestCompletionMarker}` until `synchronized`                                                        | 1 cold + W warm per boot                       |
| `thread-open`           | `GET /api/orchestration/threads/:id/bounded?compactTurnItems=1&dedupeBodies=1&compactIds=1&deferWork=1`, then `orchestration.subscribeThread {afterSequence, accept*}` until `synchronized` (`threads.ts` `makeSubscribeInput`) | small/median/largest; 1 cold + W warm per boot |
| `thread-open-socket`    | socket-only fallback: `subscribeThread` without a cursor (full snapshot over WS)                                                                                                                                                | 1 per size per boot                            |
| `thread-full-http`      | `GET /api/orchestration/threads/:id` (full detail snapshot)                                                                                                                                                                     | 1 per size per boot                            |
| `reconnect-idle`        | new socket + ticket, HTTP shell + `subscribeShell` from its sequence, `subscribeThread` (largest) from the held sequence; nothing missed                                                                                        | W per boot                                     |
| `turn`                  | one `message.dispatch` on a devReplay thread (`showcase` scenario), run to a terminal status; DB used-bytes and thread payload delta                                                                                            | T per boot (+1 launch in boot 0)               |
| `reconnect-missed-turn` | an observer holds shell + bench thread, disconnects, the turn above runs, the observer resumes from its sequences                                                                                                               | T per boot                                     |

Cold means the first request for that thread after a server boot. The OS page cache is warm
(the harness cannot drop caches without root), so cold numbers are server-process cold, not disk
cold. Each measured operation also samples `/proc` every 50 ms for server RSS (peak) and CPU seconds.

Thread picks come from `durable.ts` after boot 0's migrations: among non-deleted threads with at least
one message, sorted by durable payload bytes: small = p10, median = p50, largest = max.

Durable bytes: `dbstat` page bytes per table (and its indexes), plus per-thread payload bytes = the
stored byte length of every column of every row keyed by that thread (`thread_id`, or `stream_id`
for thread rows of `orchestration_events`), split into event log vs projections, and the thread event
log by event type.

## Surfaces

| surface                      | what maps                                                                                                                                                                    | not measured here                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| web (app.t3.codes, `npx t3`) | every client flow above: `apps/web/src/connection/runtime.ts` uses the same `ShellSnapshotLoader`, `BoundedThreadSnapshotLoader` and `client-runtime` subscriptions          | browser decode, render, IndexedDB cache                                          |
| desktop                      | same web client; the bundled server is this server (here run from source, not the `dist` bundle); the harness uses the desktop bootstrap auth path                           | Electron shell/IPC, bundled-server startup                                       |
| mobile                       | same loaders and subscriptions (`apps/mobile/src/connection/runtime.ts`); bytes map directly to mobile data use; `reconnect-*` is the new-session resume after backgrounding | app cold start, RN render, persisted cache, real network latency (loopback here) |
| remote / relay / tunnel      | byte counts map directly                                                                                                                                                     | relay hop latency, DPoP signing                                                  |

## Outputs

`<out>/samples.ndjson` (one JSON row per sample), `durable-before.json` (after migrations, before any
bench turns), `durable-after.json`, `run.json` (SHA, picks, host), `server-boot-*.log`, `bench.log`.
`report.ts` writes p50/p95 tables and one ledger row per metric:
`{experiment, sha, metric, unit, n, p50, p95, raw, at}`. Percentiles are nearest-rank.
