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

## Accounting (`accounting.ts`, P2/01)

Classifies every durable byte and projects the durable size under two eviction policies. It only
ever opens copies.

```bash
# 1. One migration boot of this SHA on a copy of the seed, then a VACUUM INTO base copy and a second
#    copy compacted by the real `t3 doctor --fix` CLI (its own base dir; no server stays up).
flock "$HEAVY_LOCK" node bench/poh/accounting.ts prepare --seed .t3/userdata/statev2.sqlite --work .t3/bench/accounting
# 2. Classify base and doctor DBs, simulate both policies on copies of the doctor DB, VACUUM, measure.
flock "$HEAVY_LOCK" node bench/poh/accounting.ts analyze --work .t3/bench/accounting --out <raw dir>
# 3. Markdown tables and ledger rows from <raw dir>/accounting.json.
node bench/poh/accounting.ts report --out <raw dir> --md tables.md --ledger ledger.jsonl
```

Classes, by column and by top-level JSON key (unlisted keys are metadata):

| class                                      | what                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| message-text                               | user/assistant text in messages, `user_message`/`assistant_message` items, plans, todo lists, handoff history copies, V1 messages                  |
| reasoning-text                             | `reasoning` item text                                                                                                                              |
| tool-input                                 | tool call arguments (`dynamic_tool.input`, `command_execution.input`, search patterns)                                                             |
| tool-output                                | `dynamic_tool.output`, `command_execution.output`, `file_change.diffStr`, `file_search.results`, `web_search.results`                              |
| image                                      | inline base64 strings (≥256 chars) anywhere in a payload                                                                                           |
| duplicate                                  | event bodies superseded by a later snapshot of the same `(stream, event type, $.id)`; subagent and commanded turn items are excluded, as in doctor |
| t3-owned                                   | T3-authored item kinds (SURFACE-MAP §1.3), non-transcript events, and T3 state tables                                                              |
| metadata                                   | ids, refs, timestamps, status, titles, other event columns, nodes, positions                                                                       |
| fts / index / cell-overhead / slack / free | FTS shadow pages, index pages, record headers, unused bytes inside pages, free pages (`dbstat`)                                                    |

Policies, applied to a copy of the doctor DB so doctor's savings are not counted twice:

- **D, dedupe only:** superseded snapshot bodies become row tombstones (`id, type, role, runId,
  ordinal, status, messageId, $evicted, bytes, sha256`); legacy `orchestration_v2_events` and V1
  `projection_thread_messages` rows are deleted. Needs no provider: the latest body stays.
- **A, keep text, evict heavy:** D, plus tool-output and image values become
  `{$evicted, bytes, sha256}`. All text, FTS and handoffs stay.
- **B, provider owns everything:** D, plus every transcript item,
  message and plan becomes a row tombstone, handoff history becomes a tombstone, and the FTS index
  is emptied.

`report` also splits the evicted bytes by provider and states which share each provider could
re-serve today (adapter `readThreadSnapshot` as written) and at its ceiling (native protocol or
store, verified in source). The matrix and its caveats live in `RESERVE` in `accounting.ts`.

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

## Synthetic seed and the 04b cloud A/B

Cloud runners never see real data. `synth-seed.ts generate` builds a public seed from scratch: a
fresh T3 home, a fixed number of devReplay turns round-robin across a fixed set of threads, then a
`VACUUM INTO` copy whose event-log prune mark is two days old (what a database that ran a #29806
build for over a day carries). `synth-seed.ts doctor` runs a checkout's own `t3 doctor --fix` on a
copy, so each base is benched on the event log its own maintenance leaves.

```bash
node bench/poh/synth-seed.ts generate --out seed.sqlite --threads 16 --turns 960 --concurrency 8
node bench/poh/synth-seed.ts doctor --seed seed.sqlite --out seed-post.sqlite
```

`p04b-job.sh <pre sha> <label> <slot>...` is one runner's whole job, run from a checkout of
`exp/poh/04b-post29806`: it installs both bases, runs the commit-window tests on each, builds the
seed, runs `p04b-ab.sh` (pre/post × window off/25 ms, interleaved per slot) and pools the result
with `p04b-ab.py` into `bench-out/<label>/`.

## Real provider turns (04c)

`real-turns.ts` replaces devReplay with real provider CLIs driven through T3's real adapters. One
invocation is one arm: a fresh copy of the seed, one server boot, then a fixed task block (read,
run a command, edit, explain, a long answer with no tools), one thread and one fresh scratch git
repo per turn. `--shape s1` runs the tasks one thread at a time; `--shape s4` dispatches 4 threads
together. The tap, the stored-event count, CPU and RSS cover each turn (s1) or batch (s4) until
the server's writes go quiet, so `p04c-ab.py` reports them per turn and per stored event.

```bash
# On a host where the provider CLIs are logged in; the harness never touches their credentials.
PROVIDERS='codex|codex|gpt-5.6-luna|reasoningEffort=low' \
  bench/poh/p04c-ab.sh seed-post.sqlite raw 0 1 2 3 4 5   # ABBA: off w25 / w25 off per slot
python3 bench/poh/p04c-ab.py raw --json ab.json
```

The bench server's `PATH` still omits provider CLIs; it gets wrappers for exactly `claude`,
`codex`, `grok` and `hermes` that drop the tap from the CLI's environment, so only the server's
own writes are counted. `ENV_<label>` and `SETTINGS_<label>` pass per-provider server env (for
example `T3CODE_CODEX_LAUNCH_ARGS`) and a bench-home `settings.json`.
