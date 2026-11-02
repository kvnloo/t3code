// PoH baseline: boots this worktree's server N times on a copy of the seeded DB and measures the
// client RPC flows (sidebar, thread open, reconnect), bytes, RSS/CPU and DB growth per turn.
// Usage: node bench/poh/bench.ts --runs 10 --warm 10 --out <dir> [--seed .t3/userdata/statev2.sqlite]
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeSqlite from "node:sqlite";

import { measureDurable, pickThreads } from "./durable.ts";
import { prepareHome } from "./prepare-home.ts";
import { ORCHESTRATION_PROTOCOL_HEADER, ORCHESTRATION_PROTOCOL_VERSION } from "./protocol.ts";
import {
  readOwnWriteBytes,
  readWriteBytes,
  repoRoot,
  sampleTree,
  startServer,
  withProcSampling,
  type RunningServer,
} from "./server.ts";
import { diffIoTap, readIoTap } from "./iotap.ts";
import { WsRpc } from "./wsrpc.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    runs: { type: "string", default: "10" },
    warm: { type: "string", default: "10" },
    turns: { type: "string", default: "1" },
    out: { type: "string" },
    seed: { type: "string", default: NodePath.join(repoRoot, ".t3/userdata/statev2.sqlite") },
    "keep-home": { type: "boolean", default: false },
    // Extra server environment, e.g. --server-env T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD=1 (A/B arms).
    "server-env": { type: "string", multiple: true, default: [] },
    // Reuse another run's thread picks (run.json) so A/B arms open the same threads.
    "picks-from": { type: "string" },
    // Bench-only LD_PRELOAD write tap (cc -O2 -shared -fPIC -o iotap.so bench/poh/iotap.c -ldl):
    // splits turn writes into WAL frames/commits and checkpoint copy-back. Use in every arm.
    iotap: { type: "string" },
  },
});
const serverEnv = Object.fromEntries(
  (args["server-env"] ?? []).map((entry) => {
    const at = entry.indexOf("=");
    if (at <= 0) throw new Error(`--server-env expects KEY=VALUE, got ${entry}`);
    return [entry.slice(0, at), entry.slice(at + 1)];
  }),
);
const RUNS = Number(args.runs);
let ioTapDir: string | undefined;
const WARM = Number(args.warm);
const TURNS_PER_BOOT = Number(args.turns);
const sha = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const dirty = NodeChildProcess.execFileSync(
  "git",
  ["status", "--porcelain", "--", ".", ":!bench"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
).trim();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = NodePath.resolve(args.out ?? NodePath.join(repoRoot, ".t3/bench/results", stamp));
NodeFS.mkdirSync(out, { recursive: true });
if (args.iotap !== undefined) {
  ioTapDir = NodePath.join(out, "iotap");
  NodeFS.mkdirSync(ioTapDir, { recursive: true });
  serverEnv.LD_PRELOAD = NodePath.resolve(args.iotap);
  serverEnv.POH_IOTAP_DIR = ioTapDir;
  serverEnv.POH_IOTAP_PAGES = "1";
}
const benchHome = NodePath.join(repoRoot, ".t3/bench");
const t3Home = NodePath.join(benchHome, `home-${stamp}`);
const samplesPath = NodePath.join(out, "samples.ndjson");

function record(sample: Record<string, unknown>) {
  NodeFS.appendFileSync(samplesPath, JSON.stringify({ sha, ...sample }) + "\n");
}

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  NodeFS.appendFileSync(NodePath.join(out, "bench.log"), line + "\n");
}

interface Session {
  readonly server: RunningServer;
  readonly headers: Record<string, string>;
}

async function authenticate(server: RunningServer): Promise<Session> {
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
    server,
    headers: {
      Authorization: `Bearer ${access_token}`,
      [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
    },
  };
}

async function httpGet(session: Session, path: string) {
  const started = performance.now();
  const response = await fetch(`${session.server.origin}${path}`, { headers: session.headers });
  const body = Buffer.from(await response.arrayBuffer());
  const ms = performance.now() - started;
  if (!response.ok)
    throw new Error(`GET ${path} -> ${response.status}: ${body.toString().slice(0, 300)}`);
  const parseStarted = performance.now();
  const json = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  return { ms, bytes: body.length, json, parseMs: performance.now() - parseStarted };
}

async function connect(session: Session) {
  const started = performance.now();
  const response = await fetch(`${session.server.origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: session.headers,
  });
  if (!response.ok) throw new Error(`ws ticket failed: ${response.status}`);
  const { ticket } = (await response.json()) as { ticket: string };
  const rpc = await WsRpc.connect(session.server.origin, ticket);
  return { rpc, connectMs: performance.now() - started };
}

/** Runs a stream RPC until its `synchronized` completion marker; returns time, bytes, items. */
async function untilSynchronized(rpc: WsRpc, tag: string, payload: unknown) {
  const started = performance.now();
  let firstChunkMs: number | undefined;
  let items = 0;
  let lastSequence: number | undefined;
  const kinds: Record<string, number> = {};
  const { done } = rpc.stream(tag, payload, (values) => {
    firstChunkMs ??= performance.now() - started;
    for (const value of values as Array<Record<string, unknown>>) {
      items += 1;
      const kind = String(value.kind);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (typeof value.sequence === "number") lastSequence = value.sequence;
      if (kind === "snapshot") {
        const snapshot = (value.snapshot ?? value) as Record<string, unknown>;
        if (typeof snapshot.snapshotSequence === "number") lastSequence = snapshot.snapshotSequence;
      }
      if (kind === "synchronized") return true;
    }
    return false;
  });
  const { bytes, frames } = await done;
  return {
    ms: performance.now() - started,
    firstChunkMs,
    bytes,
    frames,
    items,
    kinds,
    lastSequence,
  };
}

const SHELL_QUERY = "?omitIdleSubagents=1&omitOlderSettled=1";
const BOUNDED_QUERY = "?compactTurnItems=1&dedupeBodies=1&compactIds=1&deferWork=1";

/** Sidebar: HTTP shell snapshot, then subscribeShell from its sequence until synchronized. */
async function loadSidebar(session: Session, rpc: WsRpc) {
  const http = await httpGet(session, `/api/orchestration/shell${SHELL_QUERY}`);
  const ws = await untilSynchronized(rpc, "orchestration.subscribeShell", {
    afterSequence: http.json.snapshotSequence,
    omitIdleSubagents: true,
    omitOlderSettled: true,
    requestCompletionMarker: true,
  });
  return {
    ms: http.ms + ws.ms,
    httpMs: http.ms,
    httpBytes: http.bytes,
    parseMs: http.parseMs,
    wsMs: ws.ms,
    wsBytes: ws.bytes,
    threads: (http.json.threads as unknown[]).length,
    archivedThreads: (http.json.archivedThreads as unknown[]).length,
    sequence: http.json.snapshotSequence as number,
  };
}

/** Thread open as web/mobile do it: bounded HTTP snapshot, then subscribeThread from its sequence. */
async function openThread(session: Session, rpc: WsRpc, threadId: string) {
  const http = await httpGet(
    session,
    `/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded${BOUNDED_QUERY}`,
  );
  const ws = await untilSynchronized(rpc, "orchestration.subscribeThread", {
    threadId,
    afterSequence: http.json.snapshotSequence,
    requestCompletionMarker: true,
    acceptBoundedSnapshot: true,
    acceptDeferredWork: true,
    acceptCompactTurnItems: true,
    acceptCompactIds: true,
    acceptDedupedBodies: true,
  });
  return {
    ms: http.ms + ws.ms,
    httpMs: http.ms,
    httpBytes: http.bytes,
    parseMs: http.parseMs,
    wsMs: ws.ms,
    wsBytes: ws.bytes,
    hasMoreHistory: http.json.hasMoreHistory,
    sequence: http.json.snapshotSequence as number,
  };
}

/** Socket-only open (the client's fallback when HTTP fails): full snapshot over WS. */
async function openThreadSocketOnly(rpc: WsRpc, threadId: string) {
  return untilSynchronized(rpc, "orchestration.subscribeThread", {
    threadId,
    requestCompletionMarker: true,
    acceptDedupedBodies: true,
  });
}

const TERMINAL_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);

async function waitForRunsSettled(
  rpc: WsRpc,
  threadId: string,
  minRuns: number,
  timeoutMs = 120_000,
) {
  const runs = new Map<string, string>();
  let timer: NodeJS.Timeout | undefined;
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
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`turn did not settle in ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
  return runs;
}

function logicalDbBytes(dbPath: string, threadId: string) {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const page = db.prepare("PRAGMA page_size").get() as { page_size: number };
    const count = db.prepare("PRAGMA page_count").get() as { page_count: number };
    const free = db.prepare("PRAGMA freelist_count").get() as { freelist_count: number };
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
    let threadBytes = 0;
    const byTable: Record<string, number> = {};
    for (const table of tables) {
      const columns = (
        db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      const key = columns.includes("thread_id")
        ? "thread_id"
        : table === "orchestration_events"
          ? "stream_id"
          : undefined;
      if (!key) continue;
      const size = columns.map((c) => `COALESCE(LENGTH(CAST("${c}" AS BLOB)),0)`).join("+");
      const row = db
        .prepare(`SELECT SUM(${size}) AS bytes FROM "${table}" WHERE "${key}" = ?`)
        .get(threadId) as { bytes: number | null };
      const bytes = Number(row.bytes ?? 0);
      if (bytes > 0) byTable[table] = bytes;
      threadBytes += bytes;
    }
    return {
      usedBytes: (Number(count.page_count) - Number(free.freelist_count)) * Number(page.page_size),
      threadBytes,
      byTable,
    };
  } finally {
    db.close();
  }
}

const results: Record<string, unknown> = {
  sha,
  dirty,
  seed: args.seed,
  serverEnv,
  startedAt: new Date().toISOString(),
  host: {
    cpus: (await import("node:os")).availableParallelism(),
    totalMem: (await import("node:os")).totalmem(),
  },
  node: process.version,
  runs: RUNS,
  warm: WARM,
};

log(`sha ${sha}${dirty ? " (dirty outside bench/)" : ""}; out ${out}`);
const prepared = prepareHome({ seed: args.seed!, t3Home });
const dbPath = prepared.db;
log(`bench home ${t3Home} (disabled scheduled tasks: ${prepared.disabledScheduledTasks})`);

// Boot 0 runs this SHA's migrations on the copied DB; it is reported separately from cold boots.
let benchProjectId: string | undefined;
let benchThreadId: string | undefined;
let picks: ReturnType<typeof pickThreads> | undefined;
let durableBefore: ReturnType<typeof measureDurable> | undefined;

async function settle(pid: number, maxMs = 60_000) {
  const started = performance.now();
  let previous = sampleTree(pid);
  while (performance.now() - started < maxMs) {
    await new Promise((done) => setTimeout(done, 500));
    const next = sampleTree(pid);
    const busy = (next.treeCpuS - previous.treeCpuS) / 0.5;
    previous = next;
    if (busy < 0.05) break;
  }
  return performance.now() - started;
}

try {
  for (let boot = 0; boot <= RUNS; boot++) {
    const server = await startServer({
      t3Home,
      benchHome,
      env: serverEnv,
      logPath: NodePath.join(out, `server-boot-${boot}.log`),
    });
    try {
      const settleMs = await settle(server.pid);
      const idle = sampleTree(server.pid);
      log(
        `boot ${boot}: pid ${server.pid} port ${server.port} ready ${Math.round(server.startupMs)}ms settle ${Math.round(settleMs)}ms rss ${(idle.serverRss / 2 ** 20).toFixed(0)}MiB`,
      );
      record({
        kind: "boot",
        boot,
        startupMs: server.startupMs,
        settleMs,
        idleRss: idle.serverRss,
        idleTreeRss: idle.treeRss,
        bootCpuS: idle.treeCpuS,
      });
      const session = await authenticate(server);

      if (boot === 0) {
        durableBefore = measureDurable(dbPath);
        NodeFS.writeFileSync(
          NodePath.join(out, "durable-before.json"),
          JSON.stringify(durableBefore, null, 1),
        );
        picks = pickThreads(durableBefore);
        if (args["picks-from"] !== undefined) {
          const pinned = JSON.parse(NodeFS.readFileSync(args["picks-from"], "utf8"))
            .picks as Record<string, { threadId: string }>;
          const find = (size: string) => {
            const thread = durableBefore!.threads.find(
              (t) => t.threadId === pinned[size]?.threadId,
            );
            if (thread === undefined) throw new Error(`pinned ${size} thread missing from seed`);
            return thread;
          };
          picks = { small: find("small"), median: find("median"), largest: find("largest") };
        }
        const pickInfo = Object.fromEntries(
          Object.entries(picks).map(([size, t]) => [
            size,
            {
              threadId: t.threadId,
              bytes: t.bytes,
              events: t.events,
              messages: t.messages,
              turnItems: t.turnItems,
            },
          ]),
        );
        results.picks = pickInfo;
        log(`picks ${JSON.stringify(pickInfo)}`);
        // A scratch git project and a devReplay thread for simulated turns.
        const projectRoot = NodePath.join(t3Home, "bench-project");
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
        benchProjectId = NodeCrypto.randomUUID();
        const created = await fetch(`${server.origin}/api/projects/mutate`, {
          method: "POST",
          headers: { ...session.headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "project.create",
            commandId: NodeCrypto.randomUUID(),
            projectId: benchProjectId,
            title: "PoH bench",
            workspaceRoot: projectRoot,
          }),
        });
        if (!created.ok)
          throw new Error(`project create failed: ${created.status} ${await created.text()}`);
        const { rpc } = await connect(session);
        benchThreadId = NodeCrypto.randomUUID();
        const before = logicalDbBytes(dbPath, benchThreadId);
        const turnStarted = performance.now();
        await rpc.call("orchestration.launchThread", {
          commandId: NodeCrypto.randomUUID(),
          threadId: benchThreadId,
          projectId: benchProjectId,
          title: "PoH bench turns",
          modelSelection: { instanceId: "devReplay", model: "showcase" },
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: { text: "Bench turn 1", attachments: [] },
        });
        const runs = await waitForRunsSettled(rpc, benchThreadId, 1);
        const after = logicalDbBytes(dbPath, benchThreadId);
        record({
          kind: "turn",
          boot,
          turn: 1,
          ms: performance.now() - turnStarted,
          status: [...runs.values()].at(-1),
          dbUsedDelta: after.usedBytes - before.usedBytes,
          threadBytesDelta: after.threadBytes - before.threadBytes,
          threadByTable: after.byTable,
        });
        await rpc.close();
        continue;
      }

      const sizes = ["small", "median", "largest"] as const;
      const { rpc, connectMs } = await connect(session);
      record({ kind: "ws-connect", boot, ms: connectMs });

      // Sidebar, cold (first after boot) and warm.
      for (let i = 0; i <= WARM; i++) {
        const measured = await withProcSampling(server.pid, () => loadSidebar(session, rpc));
        record({
          kind: "sidebar",
          boot,
          temp: i === 0 ? "cold" : "warm",
          ...measured.result,
          peakRss: measured.peakServerRss,
          cpuS: measured.cpuS,
        });
      }

      // Thread open: cold = first open of that thread after boot; warm = repeats, interleaved.
      for (let i = 0; i <= WARM; i++) {
        for (const size of sizes) {
          const thread = picks![size];
          const measured = await withProcSampling(server.pid, () =>
            openThread(session, rpc, thread.threadId),
          );
          record({
            kind: "thread-open",
            boot,
            size,
            temp: i === 0 ? "cold" : "warm",
            threadId: thread.threadId,
            ...measured.result,
            peakRss: measured.peakServerRss,
            cpuS: measured.cpuS,
          });
        }
      }
      for (const size of sizes) {
        const thread = picks![size];
        const measured = await withProcSampling(server.pid, () =>
          openThreadSocketOnly(rpc, thread.threadId),
        );
        record({
          kind: "thread-open-socket",
          boot,
          size,
          temp: "warm",
          threadId: thread.threadId,
          ms: measured.result.ms,
          wsBytes: measured.result.bytes,
          peakRss: measured.peakServerRss,
          cpuS: measured.cpuS,
        });
        const full = await httpGet(
          session,
          `/api/orchestration/threads/${encodeURIComponent(thread.threadId)}`,
        );
        record({
          kind: "thread-full-http",
          boot,
          size,
          temp: "warm",
          threadId: thread.threadId,
          ms: full.ms,
          httpBytes: full.bytes,
          parseMs: full.parseMs,
        });
      }

      // Reconnect with nothing missed: a client that held the shell and the largest thread.
      const sidebar = await loadSidebar(session, rpc);
      const held = await openThread(session, rpc, picks!.largest.threadId);
      await rpc.close();
      for (let i = 0; i < WARM; i++) {
        const measured = await withProcSampling(server.pid, async () => {
          const started = performance.now();
          const next = await connect(session);
          const shellHttp = await httpGet(session, `/api/orchestration/shell${SHELL_QUERY}`);
          const shell = await untilSynchronized(next.rpc, "orchestration.subscribeShell", {
            afterSequence: shellHttp.json.snapshotSequence,
            omitIdleSubagents: true,
            omitOlderSettled: true,
            requestCompletionMarker: true,
          });
          const thread = await untilSynchronized(next.rpc, "orchestration.subscribeThread", {
            threadId: picks!.largest.threadId,
            afterSequence: held.sequence,
            requestCompletionMarker: true,
            acceptBoundedSnapshot: true,
            acceptDeferredWork: true,
            acceptCompactTurnItems: true,
            acceptCompactIds: true,
            acceptDedupedBodies: true,
          });
          const ms = performance.now() - started;
          const wsBytes = next.rpc.inbound.bytes;
          await next.rpc.close();
          return {
            ms,
            connectMs: next.connectMs,
            httpBytes: shellHttp.bytes,
            wsBytes,
            shellWsBytes: shell.bytes,
            threadWsBytes: thread.bytes,
            threadItems: thread.items,
            threadKinds: thread.kinds,
          };
        });
        record({
          kind: "reconnect-idle",
          boot,
          ...measured.result,
          peakRss: measured.peakServerRss,
          cpuS: measured.cpuS,
        });
      }

      // Reconnect after missing a turn: the observer holds the bench thread, disconnects, a
      // devReplay turn runs from another socket, then the observer resumes from its sequence.
      for (let t = 0; t < TURNS_PER_BOOT; t++) {
        const observer = await connect(session);
        const observerShell = await loadSidebar(session, observer.rpc);
        const observerThread = await openThread(session, observer.rpc, benchThreadId!);
        await observer.rpc.close();
        const driver = await connect(session);
        const before = logicalDbBytes(dbPath, benchThreadId!);
        const writesBefore = readWriteBytes(server.pid);
        const tapBefore = readIoTap(ioTapDir, server.pid);
        const ownWritesBefore = readOwnWriteBytes(server.pid);
        const turnStarted = performance.now();
        const turnSample = await withProcSampling(server.pid, async () => {
          const projection = (
            await driver.rpc.call<Record<string, any>>("orchestration.getThreadProjection", {
              threadId: benchThreadId,
            })
          ).value;
          const runCount = (projection.runs ?? projection.projection?.runs ?? []).length;
          await driver.rpc.call("orchestration.dispatchCommand", {
            type: "message.dispatch",
            commandId: NodeCrypto.randomUUID(),
            threadId: benchThreadId,
            messageId: NodeCrypto.randomUUID(),
            text: `Bench turn boot ${boot} #${t + 1}`,
            attachments: [],
            createdBy: "user",
            creationSource: "web",
            dispatchMode: { type: "start_immediately" },
          });
          return waitForRunsSettled(driver.rpc, benchThreadId!, runCount + 1);
        });
        const turnMs = performance.now() - turnStarted;
        const writesAfter = readWriteBytes(server.pid);
        const io = diffIoTap(tapBefore, readIoTap(ioTapDir, server.pid));
        const ownWritesAfter = readOwnWriteBytes(server.pid);
        await driver.rpc.close();
        const after = logicalDbBytes(dbPath, benchThreadId!);
        record({
          kind: "turn",
          boot,
          turn: t + 1,
          ms: turnMs,
          status: [...turnSample.result.values()].at(-1),
          dbUsedDelta: after.usedBytes - before.usedBytes,
          threadBytesDelta: after.threadBytes - before.threadBytes,
          threadByTable: after.byTable,
          ...(writesBefore === undefined || writesAfter === undefined
            ? {}
            : { serverWriteBytes: writesAfter - writesBefore }),
          ...(ownWritesBefore === undefined || ownWritesAfter === undefined
            ? {}
            : { serverOwnWriteBytes: ownWritesAfter - ownWritesBefore }),
          ...(io === undefined ? {} : { io, ioStart: tapBefore }),
          peakRss: turnSample.peakServerRss,
          cpuS: turnSample.cpuS,
        });
        const measured = await withProcSampling(server.pid, async () => {
          const started = performance.now();
          const next = await connect(session);
          const shellHttp = await httpGet(session, `/api/orchestration/shell${SHELL_QUERY}`);
          const shell = await untilSynchronized(next.rpc, "orchestration.subscribeShell", {
            afterSequence: shellHttp.json.snapshotSequence,
            omitIdleSubagents: true,
            omitOlderSettled: true,
            requestCompletionMarker: true,
          });
          const thread = await untilSynchronized(next.rpc, "orchestration.subscribeThread", {
            threadId: benchThreadId,
            afterSequence: observerThread.sequence,
            requestCompletionMarker: true,
            acceptBoundedSnapshot: true,
            acceptDeferredWork: true,
            acceptCompactTurnItems: true,
            acceptCompactIds: true,
            acceptDedupedBodies: true,
          });
          const ms = performance.now() - started;
          const wsBytes = next.rpc.inbound.bytes;
          await next.rpc.close();
          return {
            ms,
            httpBytes: shellHttp.bytes,
            wsBytes,
            shellWsBytes: shell.bytes,
            threadWsBytes: thread.bytes,
            threadItems: thread.items,
            threadKinds: thread.kinds,
            missedSequences:
              (thread.lastSequence ?? observerThread.sequence) - observerThread.sequence,
            shellSequenceGap: (shellHttp.json.snapshotSequence as number) - observerShell.sequence,
          };
        });
        record({
          kind: "reconnect-missed-turn",
          boot,
          ...measured.result,
          peakRss: measured.peakServerRss,
          cpuS: measured.cpuS,
        });
      }
      const end = sampleTree(server.pid);
      record({
        kind: "boot-end",
        boot,
        rss: end.serverRss,
        treeRss: end.treeRss,
        treeCpuS: end.treeCpuS,
        processes: end.processes,
        io: readIoTap(ioTapDir, server.pid),
      });
      void sidebar;
    } finally {
      await server.stop();
    }
  }
  const durableAfter = measureDurable(dbPath);
  if (ioTapDir !== undefined) {
    // Page owners after the run, run-length encoded as [firstPage, btree], to name the tap's WAL pages.
    const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const ranges: Array<[number, string]> = [];
      const rows = db.prepare("SELECT pageno, name FROM dbstat ORDER BY pageno").iterate();
      for (const row of rows as Iterable<{ pageno: number; name: string }>) {
        if (ranges.at(-1)?.[1] !== row.name) ranges.push([row.pageno, row.name]);
      }
      NodeFS.writeFileSync(NodePath.join(out, "pagemap.json"), JSON.stringify(ranges));
    } finally {
      db.close();
    }
  }
  NodeFS.writeFileSync(
    NodePath.join(out, "durable-after.json"),
    JSON.stringify(durableAfter, null, 1),
  );
  results.finishedAt = new Date().toISOString();
  results.benchThreadId = benchThreadId;
  NodeFS.writeFileSync(NodePath.join(out, "run.json"), JSON.stringify(results, null, 2));
  log(`done: ${out}`);
} finally {
  if (!args["keep-home"]) NodeFS.rmSync(t3Home, { recursive: true, force: true });
}
