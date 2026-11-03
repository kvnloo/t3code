// Public synthetic seed for PoH runs that leave the maintainer's machines (cloud runners).
//
//   generate: boots this checkout's server on a fresh T3 home, plays a fixed number of devReplay
//             turns round-robin across a fixed set of threads, then writes a VACUUM INTO copy.
//             The copy carries an event-log prune mark two days old, as a database that has been
//             running a pruning build for more than a day would (#29806 prunes only through a mark
//             at least a day old; builds before it ignore the row).
//   doctor:   runs this checkout's own `t3 doctor --fix` (its event-log maintenance plus VACUUM)
//             on a copy of a seed, so each base benches the steady state its maintenance leaves.
//
// usage: node bench/poh/synth-seed.ts generate --out seed.sqlite [--threads 16] [--turns 960]
//          [--concurrency 8] [--scenario showcase]
//        node bench/poh/synth-seed.ts doctor --seed seed.sqlite --out seed-<base>.sqlite
//
// Content is deterministic (thread count, turn order, prompts, replay scenario); ids and timings
// are not. Nothing is read from an existing T3 home.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import { ORCHESTRATION_PROTOCOL_HEADER, ORCHESTRATION_PROTOCOL_VERSION } from "./protocol.ts";
import { repoRoot, startServer, type RunningServer } from "./server.ts";
import { WsRpc } from "./wsrpc.ts";

const { values: args, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    seed: { type: "string" },
    threads: { type: "string", default: "16" },
    turns: { type: "string", default: "960" },
    concurrency: { type: "string", default: "8" },
    scenario: { type: "string", default: "showcase" },
  },
});
const TERMINAL_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
const PRUNE_MARK = "event-log-prune-mark";
const benchHome = NodePath.join(repoRoot, ".t3/bench");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);

function vacuumInto(source: string, target: string) {
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) NodeFS.rmSync(target + suffix, { force: true });
  const db = new NodeSqlite.DatabaseSync(source, { readOnly: true });
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  db.close();
}

/** Event-log shape of a seed: what pruning acts on. */
function describe(path: string) {
  const db = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  const one = (sql: string) => db.prepare(sql).get() as Record<string, number>;
  const shape = {
    fileBytes: NodeFS.statSync(path).size,
    events: one("SELECT COUNT(*) AS n FROM orchestration_events").n,
    eventPayloadBytes: one(
      "SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS n FROM orchestration_events",
    ).n,
    maxSequence: one("SELECT COALESCE(MAX(sequence), 0) AS n FROM orchestration_events").n,
    threads: one("SELECT COUNT(DISTINCT stream_id) AS n FROM orchestration_events WHERE aggregate_kind = 'thread'").n,
    pageSize: one("PRAGMA page_size").page_size,
    autoVacuum: one("PRAGMA auto_vacuum").auto_vacuum,
  };
  db.close();
  return shape;
}

async function authenticate(server: RunningServer) {
  const response = await fetch(`${server.origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: server.bootstrapToken,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  if (!response.ok) throw new Error(`token exchange failed: ${response.status}`);
  const { access_token } = (await response.json()) as { access_token: string };
  return {
    Authorization: `Bearer ${access_token}`,
    [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
  };
}

async function connect(server: RunningServer, headers: Record<string, string>) {
  const response = await fetch(`${server.origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw new Error(`ws ticket failed: ${response.status}`);
  const { ticket } = (await response.json()) as { ticket: string };
  return WsRpc.connect(server.origin, ticket);
}

/** Resolves once the thread has at least `minRuns` runs and all of them are terminal. */
async function waitForRuns(rpc: WsRpc, threadId: string, minRuns: number, timeoutMs = 180_000) {
  const runs = new Map<string, string>();
  const { done } = rpc.stream(
    "orchestration.subscribeThread",
    { threadId, requestCompletionMarker: true },
    (values) => {
      for (const value of values as Array<Record<string, any>>) {
        if (value.kind === "snapshot") {
          for (const run of value.projection.runs ?? []) runs.set(run.id, run.status);
        } else if (value.kind === "event" && value.event?.type === "run.updated") {
          runs.set(value.event.payload.id, value.event.payload.status);
        }
      }
      return runs.size >= minRuns && [...runs.values()].every((status) => TERMINAL_RUN.has(status));
    },
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${threadId} did not settle`)), timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
  const statuses = [...runs.values()];
  if (statuses.at(-1) !== "completed") throw new Error(`${threadId} run ended ${statuses.at(-1)}`);
}

async function generate() {
  if (args.out === undefined) throw new Error("generate needs --out");
  const out = NodePath.resolve(args.out);
  const threadCount = Number(args.threads);
  const turnCount = Number(args.turns);
  const concurrency = Math.min(Number(args.concurrency), threadCount);
  if (threadCount % concurrency !== 0) throw new Error("--threads must be a multiple of --concurrency");
  const t3Home = NodePath.join(benchHome, `synth-${stamp}`);
  const userdata = NodePath.join(t3Home, "userdata");
  NodeFS.mkdirSync(userdata, { recursive: true });
  // Holds the first background event-log pass six hours out, so generation leaves the log whole.
  NodeFS.writeFileSync(NodePath.join(userdata, "compacted-at"), String(Date.now()));
  const server = await startServer({
    t3Home,
    benchHome,
    logPath: NodePath.join(NodePath.dirname(out), "synth-server.log"),
  });
  const started = performance.now();
  try {
    const headers = await authenticate(server);
    const projectRoot = NodePath.join(t3Home, "synth-project");
    NodeFS.mkdirSync(projectRoot, { recursive: true });
    NodeChildProcess.execFileSync("git", ["init", "-q", projectRoot]);
    NodeChildProcess.execFileSync("git", [
      "-C",
      projectRoot,
      "-c",
      "user.name=Bench",
      "-c",
      "user.email=bench@localhost",
      "commit",
      "--allow-empty",
      "-qm",
      "initial",
    ]);
    const projectId = NodeCrypto.randomUUID();
    const created = await fetch(`${server.origin}/api/projects/mutate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "project.create",
        commandId: NodeCrypto.randomUUID(),
        projectId,
        title: "PoH synthetic seed",
        workspaceRoot: projectRoot,
      }),
    });
    if (!created.ok) throw new Error(`project create failed: ${created.status} ${await created.text()}`);
    const threadIds = Array.from({ length: threadCount }, () => NodeCrypto.randomUUID());
    // Turn k goes to thread k % threads; worker w owns threads i with i % concurrency == w, so
    // no thread ever has two turns in flight. Turn k < threads launches its thread.
    let finished = 0;
    const worker = async (w: number) => {
      const rpc = await connect(server, headers);
      const runsByThread = new Map<string, number>();
      try {
        for (let k = 0; k < turnCount; k++) {
          const index = k % threadCount;
          if (index % concurrency !== w) continue;
          const threadId = threadIds[index]!;
          const text = `Synthetic seed turn ${Math.floor(k / threadCount) + 1} on thread ${index + 1}`;
          const runs = (runsByThread.get(threadId) ?? 0) + 1;
          let settled: Promise<void>;
          if (k < threadCount) {
            // The thread does not exist until launch; its snapshot then carries the run.
            await rpc.call("orchestration.launchThread", {
              commandId: NodeCrypto.randomUUID(),
              threadId,
              projectId,
              title: `Synthetic thread ${index + 1}`,
              modelSelection: { instanceId: "devReplay", model: args.scenario },
              runtimeMode: "full-access",
              interactionMode: "default",
              workspaceStrategy: { type: "root" },
              initialMessage: { text, attachments: [] },
            });
            settled = waitForRuns(rpc, threadId, runs);
          } else {
            settled = waitForRuns(rpc, threadId, runs);
            settled.catch(() => {});
            await rpc.call("orchestration.dispatchCommand", {
              type: "message.dispatch",
              commandId: NodeCrypto.randomUUID(),
              threadId,
              messageId: NodeCrypto.randomUUID(),
              text,
              attachments: [],
              createdBy: "user",
              creationSource: "web",
              dispatchMode: { type: "start_immediately" },
            });
          }
          await settled;
          runsByThread.set(threadId, runs);
          finished += 1;
          if (finished % 50 === 0 || finished === turnCount) {
            const bytes = NodeFS.statSync(NodePath.join(userdata, "statev2.sqlite")).size;
            log(
              `${finished}/${turnCount} turns, db ${(bytes / 2 ** 20).toFixed(1)} MiB, ${Math.round((performance.now() - started) / 1000)} s`,
            );
          }
        }
      } finally {
        await rpc.close();
      }
    };
    await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w)));
  } finally {
    await server.stop();
  }
  vacuumInto(NodePath.join(userdata, "statev2.sqlite"), out);
  const db = new NodeSqlite.DatabaseSync(out);
  db.prepare(
    `INSERT INTO orchestration_v2_projection_metadata (projection_name, schema_version, last_sequence, updated_at)
     SELECT ?, schema_version, (SELECT MAX(sequence) FROM orchestration_events), ?
     FROM orchestration_v2_projection_metadata WHERE projection_name = 'thread-projections'
     ON CONFLICT(projection_name) DO UPDATE SET
       last_sequence = excluded.last_sequence, updated_at = excluded.updated_at`,
  ).run(PRUNE_MARK, new Date(Date.now() - 2 * 86_400_000).toISOString());
  db.close();
  NodeFS.rmSync(t3Home, { recursive: true, force: true });
  const manifest = {
    sha: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    threads: threadCount,
    turns: turnCount,
    concurrency,
    scenario: args.scenario,
    generateSeconds: (performance.now() - started) / 1000,
    seed: describe(out),
  };
  NodeFS.writeFileSync(`${out}.json`, JSON.stringify(manifest, null, 1));
  log(`seed ${out}: ${JSON.stringify(manifest)}`);
}

function doctor() {
  if (args.seed === undefined || args.out === undefined) throw new Error("doctor needs --seed and --out");
  const out = NodePath.resolve(args.out);
  const baseDir = NodePath.join(benchHome, `doctor-${stamp}`);
  const db = NodePath.join(baseDir, "userdata", "statev2.sqlite");
  vacuumInto(NodePath.resolve(args.seed), db);
  const before = describe(db);
  const started = performance.now();
  // The real CLI. Its service pause only touches a boot service installed for this base dir.
  const result = NodeChildProcess.spawnSync(
    process.execPath,
    ["apps/server/src/bin.ts", "doctor", "--base-dir", baseDir, "--fix"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, T3CODE_TELEMETRY_ENABLED: "false" } },
  );
  NodeFS.writeFileSync(`${out}.doctor.log`, `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) throw new Error(`doctor exited ${result.status}; see ${out}.doctor.log`);
  vacuumInto(db, out);
  NodeFS.rmSync(baseDir, { recursive: true, force: true });
  const manifest = {
    sha: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    doctorSeconds: (performance.now() - started) / 1000,
    before,
    after: describe(out),
  };
  NodeFS.writeFileSync(`${out}.json`, JSON.stringify(manifest, null, 1));
  log(`doctor ${out}: ${JSON.stringify(manifest)}`);
}

if (positionals[0] === "generate") await generate();
else if (positionals[0] === "doctor") doctor();
else throw new Error("usage: synth-seed.ts generate|doctor ...");
