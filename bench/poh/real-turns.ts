// PoH 04c: real provider turns through T3's real adapters (no devReplay), measured by the same
// server-only syscall tap as bench.ts. One invocation is one arm: a fresh copy of the seed, one
// server boot, then a fixed block of turns in one of two shapes:
//   s1: one thread at a time; each task in TASKS once, in order.
//   s4: batches of 4 threads dispatched together on the same server (subagent fan-out); batch g
//       runs tasks g..g+3 (mod TASKS), so both arms of a slot see the same prompts in the same order.
// Every turn gets its own thread, project and fresh copy of a scratch git repo. The SQLite tap,
// event count, CPU and RSS are taken over the whole turn (s1) or batch (s4), until the server's
// writes go quiet after the last run settles; live-event timings are per thread.
//
// usage: node bench/poh/real-turns.ts --seed seed.sqlite --out <dir> --iotap iotap.so
//          --instance claudeAgent --model claude-haiku-5-5 [--option effort=low] --shape s1|s4
//          [--batches 2] [--batch-offset 0] [--server-env K=V]
//        node bench/poh/real-turns.ts --probe --seed seed.sqlite --out <dir>   (providers + models)
//
// The provider CLIs run under the invoking user's existing logins (HOME is passed through). The
// harness never reads, prints or copies their credentials; the wrappers below only unset the tap.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import { diffIoTap, readIoTap, type IoTap } from "./iotap.ts";
import { prepareHome } from "./prepare-home.ts";
import { ORCHESTRATION_PROTOCOL_HEADER, ORCHESTRATION_PROTOCOL_VERSION } from "./protocol.ts";
import { repoRoot, sampleTree, sandboxPath, startServer, type RunningServer } from "./server.ts";
import { WsRpc } from "./wsrpc.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    seed: { type: "string" },
    out: { type: "string" },
    iotap: { type: "string" },
    instance: { type: "string" },
    model: { type: "string" },
    option: { type: "string", multiple: true, default: [] },
    shape: { type: "string", default: "s1" },
    batches: { type: "string", default: "2" },
    "batch-offset": { type: "string", default: "0" },
    "turn-timeout": { type: "string", default: "600" },
    "server-env": { type: "string", multiple: true, default: [] },
    // Bench-home settings.json, e.g. '{"providerInstances":{"grok":{"driver":"grok","enabled":true}}}'.
    settings: { type: "string" },
    probe: { type: "boolean", default: false },
    "keep-home": { type: "boolean", default: false },
  },
});

/** The fixed workload: read, run a command, edit, explain, and one long answer without tools. */
export const TASKS = [
  {
    id: "read",
    text: "Read README.md and src/invoice.py. Summarize what this project does in three bullet points. Do not modify any files.",
  },
  {
    id: "command",
    text: "Run `python3 -m unittest discover -s tests -v` in the repository root and report how many tests ran and whether they all passed. Do not modify any files.",
  },
  {
    id: "edit",
    text: "Edit src/invoice.py: add a function `format_money(cents: int) -> str` that returns strings like `$12.34`, and `-$12.34` for negative amounts. Add one unittest for it in tests/test_invoice.py. Keep the change small and do not run anything.",
  },
  {
    id: "explain",
    text: "Explain how `apply_discount` in src/invoice.py handles rounding and its edge cases. Quote the relevant lines. Do not modify any files.",
  },
  {
    id: "long",
    text: "Without using any tools or reading any files, write a detailed explanation, about 600 words, of how SQLite's write-ahead log works: frames, commits, checkpoints and concurrent readers. Answer directly in plain prose.",
  },
] as const;

const SCRATCH_FILES: Record<string, string> = {
  "README.md": `# invoice-tools

Small, dependency-free helpers for computing invoice totals in integer cents.

- \`line_total\` multiplies quantity by unit price.
- \`subtotal\` sums line totals.
- \`apply_discount\` takes a percentage discount, rounding half up to the cent.
- \`total\` adds tax on the discounted subtotal.

Run the tests with \`python3 -m unittest discover -s tests -v\`.
`,
  "src/invoice.py": `"""Invoice arithmetic in integer cents."""
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class Line:
    description: str
    quantity: int
    unit_cents: int


def line_total(line: Line) -> int:
    if line.quantity < 0:
        raise ValueError("quantity must be non-negative")
    return line.quantity * line.unit_cents


def subtotal(lines: list[Line]) -> int:
    return sum(line_total(line) for line in lines)


def apply_discount(cents: int, percent: float) -> int:
    if not 0 <= percent <= 100:
        raise ValueError("percent must be between 0 and 100")
    discounted = Decimal(cents) * (Decimal(100) - Decimal(str(percent))) / Decimal(100)
    return int(discounted.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def tax(cents: int, rate_percent: float) -> int:
    value = Decimal(cents) * Decimal(str(rate_percent)) / Decimal(100)
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def total(lines: list[Line], discount_percent: float = 0, tax_percent: float = 0) -> int:
    discounted = apply_discount(subtotal(lines), discount_percent)
    return discounted + tax(discounted, tax_percent)
`,
  "src/__init__.py": "",
  "tests/__init__.py": "",
  "tests/test_invoice.py": `import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from invoice import Line, apply_discount, line_total, subtotal, tax, total  # noqa: E402


class InvoiceTest(unittest.TestCase):
    def test_line_total(self):
        self.assertEqual(line_total(Line("pen", 3, 125)), 375)

    def test_negative_quantity(self):
        with self.assertRaises(ValueError):
            line_total(Line("pen", -1, 125))

    def test_subtotal(self):
        self.assertEqual(subtotal([Line("a", 1, 100), Line("b", 2, 250)]), 600)

    def test_discount_rounds_half_up(self):
        self.assertEqual(apply_discount(105, 10), 95)

    def test_discount_bounds(self):
        with self.assertRaises(ValueError):
            apply_discount(100, 120)

    def test_tax(self):
        self.assertEqual(tax(1000, 8.25), 83)

    def test_total(self):
        self.assertEqual(total([Line("a", 2, 500)], discount_percent=10, tax_percent=5), 945)


if __name__ == "__main__":
    unittest.main()
`,
};

const serverEnv: Record<string, string> = Object.fromEntries(
  (args["server-env"] ?? []).map((entry) => {
    const at = entry.indexOf("=");
    if (at <= 0) throw new Error(`--server-env expects KEY=VALUE, got ${entry}`);
    return [entry.slice(0, at), entry.slice(at + 1)];
  }),
);
if (args.seed === undefined || args.out === undefined)
  throw new Error("--seed and --out are required");
const out = NodePath.resolve(args.out);
NodeFS.mkdirSync(out, { recursive: true });
let ioTapDir: string | undefined;
if (args.iotap !== undefined) {
  ioTapDir = NodePath.join(out, "iotap");
  NodeFS.mkdirSync(ioTapDir, { recursive: true });
  serverEnv.LD_PRELOAD = NodePath.resolve(args.iotap);
  serverEnv.POH_IOTAP_DIR = ioTapDir;
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const benchHome = NodePath.join(repoRoot, ".t3/bench");
const t3Home = NodePath.join(benchHome, `real-${stamp}-${process.pid}`);
const sha = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const samplesPath = NodePath.join(out, "samples.ndjson");
const TERMINAL_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
const TURN_TIMEOUT_MS = Number(args["turn-timeout"]) * 1000;

function record(sample: Record<string, unknown>) {
  NodeFS.appendFileSync(samplesPath, JSON.stringify({ sha, ...sample }) + "\n");
}

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  NodeFS.appendFileSync(NodePath.join(out, "bench.log"), line + "\n");
}

/**
 * PATH for the bench server: the sandbox (no provider CLIs) plus wrappers for exactly the provider
 * CLIs this run uses. A wrapper drops the tap from the CLI's environment, so only the server's own
 * writes are counted, then execs the CLI the invoking user's PATH resolves.
 */
function providerPath(): string {
  const wrappers = NodePath.join(t3Home, "provider-bin");
  NodeFS.mkdirSync(wrappers, { recursive: true });
  for (const name of ["claude", "codex", "grok", "hermes"]) {
    const resolved = NodeChildProcess.spawnSync("sh", ["-c", `command -v ${name}`], {
      encoding: "utf8",
    }).stdout.trim();
    if (resolved === "") continue;
    const wrapper = NodePath.join(wrappers, name);
    NodeFS.writeFileSync(
      wrapper,
      `#!/bin/sh\nunset LD_PRELOAD POH_IOTAP_DIR POH_IOTAP_PAGES\nexec ${JSON.stringify(resolved)} "$@"\n`,
    );
    NodeFS.chmodSync(wrapper, 0o755);
  }
  return `${wrappers}:${sandboxPath(benchHome)}`;
}

function cliVersions() {
  const version = (name: string) =>
    NodeChildProcess.spawnSync(name, ["--version"], { encoding: "utf8" }).stdout?.trim() || null;
  return {
    claude: version("claude"),
    codex: version("codex"),
    grok: version("grok"),
    hermes: version("hermes")?.split("\n")[0] ?? null,
    node: process.version,
  };
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

async function connect(session: Session) {
  const response = await fetch(`${session.server.origin}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: session.headers,
  });
  if (!response.ok) throw new Error(`ws ticket failed: ${response.status}`);
  const { ticket } = (await response.json()) as { ticket: string };
  return WsRpc.connect(session.server.origin, ticket);
}

/** Provider snapshots without account details: only what identifies the CLI, model and state. */
function describeProviders(providers: ReadonlyArray<Record<string, any>>) {
  return providers.map((p) => ({
    instanceId: p.instanceId,
    driver: p.driver,
    enabled: p.enabled,
    installed: p.installed,
    version: p.version,
    installedVersion: p.installedVersion,
    status: p.status,
    authStatus: p.auth?.status,
    availability: p.availability,
    message: p.message,
    models: (p.models ?? []).map((m: Record<string, any>) => ({
      slug: m.slug,
      name: m.name,
      isDefault: m.isDefault,
      capabilities: m.capabilities,
    })),
  }));
}

/** Waits until the provider `instanceId` is ready and, when given, offers `model`. */
async function providerSnapshot(
  rpc: WsRpc,
  instanceId: string | undefined,
  timeoutMs = 120_000,
  model?: string,
) {
  const started = performance.now();
  for (;;) {
    const config = (await rpc.call<Record<string, any>>("server.getConfig", {})).value;
    const providers = (config.providers ?? []) as Array<Record<string, any>>;
    const target = providers.find((p) => p.instanceId === instanceId);
    const offered =
      model === undefined ||
      (target?.models ?? []).some((m: Record<string, any>) => m.slug === model);
    if (instanceId === undefined || (target?.status === "ready" && offered)) {
      return { providers, target };
    }
    if (performance.now() - started > timeoutMs) {
      throw new Error(
        `provider ${instanceId} not ready: ${JSON.stringify(describeProviders(providers).find((p) => p.instanceId === instanceId) ?? null)}`,
      );
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
}

function makeScratchRepo(dir: string) {
  for (const [file, content] of Object.entries(SCRATCH_FILES)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, file), content);
  }
  const git = (...gitArgs: string[]) =>
    NodeChildProcess.execFileSync("git", ["-C", dir, ...gitArgs], { stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Bench", "-c", "user.email=bench@localhost", "commit", "-qm", "initial");
}

interface LiveArrival {
  readonly at: number;
  readonly lagMs: number;
  readonly assistant: boolean;
}

const quantile = (values: ReadonlyArray<number>, q: number) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};

/** Same per-turn live summary as bench.ts. */
function summarizeArrivals(all: ReadonlyArray<LiveArrival>, dispatchedAt: number) {
  const arrivals = all.filter((arrival) => arrival.at >= dispatchedAt);
  const firstAssistant = arrivals.find((arrival) => arrival.assistant);
  const frameTimes = [...new Set(arrivals.map((arrival) => arrival.at))];
  const gaps = frameTimes.slice(1).map((at, index) => at - frameTimes[index]!);
  const assistantTimes = [
    ...new Set(arrivals.filter((arrival) => arrival.assistant).map((arrival) => arrival.at)),
  ];
  const assistantGaps = assistantTimes.slice(1).map((at, index) => at - assistantTimes[index]!);
  const lags = arrivals.map((arrival) => arrival.lagMs);
  return {
    events: arrivals.length,
    frames: frameTimes.length,
    firstEventMs: arrivals[0] === undefined ? null : arrivals[0].at - dispatchedAt,
    firstAssistantMs: firstAssistant === undefined ? null : firstAssistant.at - dispatchedAt,
    lagP50Ms: quantile(lags, 0.5),
    lagP95Ms: quantile(lags, 0.95),
    lagMaxMs: quantile(lags, 1),
    frameGapP50Ms: quantile(gaps, 0.5),
    assistantGapP50Ms: quantile(assistantGaps, 0.5),
    assistantGapP95Ms: quantile(assistantGaps, 0.95),
  };
}

/**
 * A thread subscription opened before dispatch: resolves `ready` at the completion marker and
 * `settled` once a run exists and every run is terminal, timing every live event on arrival.
 */
function watchThread(rpc: WsRpc, threadId: string) {
  const runs = new Map<string, string>();
  // The last run payload, kept so a failed turn records why it failed.
  let lastRun: Record<string, unknown> | undefined;
  const arrivals: Array<LiveArrival> = [];
  const ready = Promise.withResolvers<void>();
  let settledAt = 0;
  const { done } = rpc.stream(
    "orchestration.subscribeThread",
    { threadId, requestCompletionMarker: true },
    (values) => {
      const at = Date.now();
      for (const value of values as Array<Record<string, any>>) {
        if (value.kind === "synchronized") ready.resolve();
        if (value.kind === "event" && value.event !== undefined) {
          const event = value.event;
          const occurredAt = Date.parse(String(event.occurredAt));
          arrivals.push({
            at,
            lagMs: Number.isFinite(occurredAt) ? at - occurredAt : NaN,
            assistant:
              (event.type === "message.updated" && event.payload?.role === "assistant") ||
              (event.type === "turn-item.updated" &&
                (event.payload?.type === "assistant_message" ||
                  event.payload?.type === "reasoning")),
          });
          if (event.type === "run.updated") {
            runs.set(event.payload.id, event.payload.status);
            lastRun = event.payload;
          }
        } else if (value.kind === "snapshot") {
          for (const run of value.projection.runs ?? []) runs.set(run.id, run.status);
        }
      }
      const settled =
        runs.size >= 1 && [...runs.values()].every((status) => TERMINAL_RUN.has(status));
      if (settled) settledAt = Date.now();
      return settled;
    },
  );
  done.catch((error: unknown) => ready.reject(error));
  let timer: NodeJS.Timeout | undefined;
  const settled = Promise.race([
    done,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${threadId} did not settle in ${TURN_TIMEOUT_MS}ms`)),
        TURN_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  settled.catch(() => {});
  return {
    ready: ready.promise,
    settled,
    runs,
    arrivals,
    settledAt: () => settledAt,
    lastRun: () => lastRun,
  };
}

function maxSequence(db: string) {
  const sql = new NodeSqlite.DatabaseSync(db, { readOnly: true });
  try {
    return Number(
      (
        sql.prepare("SELECT COALESCE(MAX(sequence), 0) AS n FROM orchestration_events").get() as {
          n: number;
        }
      ).n,
    );
  } finally {
    sql.close();
  }
}

/** Events stored after `sequence`, in total and for each given thread stream. */
function eventsSince(db: string, sequence: number, threadIds: ReadonlyArray<string>) {
  const sql = new NodeSqlite.DatabaseSync(db, { readOnly: true });
  try {
    const rows = sql
      .prepare(
        "SELECT stream_id, event_type, COUNT(*) AS n, SUM(LENGTH(payload_json)) AS bytes FROM orchestration_events WHERE sequence > ? GROUP BY stream_id, event_type",
      )
      .all(sequence) as Array<{ stream_id: string; event_type: string; n: number; bytes: number }>;
    const byType: Record<string, number> = {};
    const byThread: Record<string, number> = Object.fromEntries(threadIds.map((id) => [id, 0]));
    let total = 0;
    let payloadBytes = 0;
    for (const row of rows) {
      total += Number(row.n);
      payloadBytes += Number(row.bytes ?? 0);
      byType[row.event_type] = (byType[row.event_type] ?? 0) + Number(row.n);
      if (row.stream_id in byThread) byThread[row.stream_id]! += Number(row.n);
    }
    return { total, payloadBytes, byType, byThread };
  } finally {
    sql.close();
  }
}

/**
 * Waits until the server's SQLite writes stop: no new WAL commit or stored event for `quietMs`.
 * This is the measurement boundary, so trailing turn work (checkpoint, receipts) lands in the turn
 * that caused it and not in the next one.
 */
async function drain(pid: number, db: string, quietMs = 1500, maxMs = 30_000) {
  const started = performance.now();
  const probe = () => `${readIoTap(ioTapDir, pid)?.walCommits ?? 0}:${maxSequence(db)}`;
  let last = probe();
  let lastChange = performance.now();
  while (performance.now() - lastChange < quietMs && performance.now() - started < maxMs) {
    await new Promise((done) => setTimeout(done, 100));
    const next = probe();
    if (next !== last) {
      last = next;
      lastChange = performance.now();
    }
  }
  return performance.now() - started;
}

async function itemCounts(rpc: WsRpc, threadId: string) {
  const projection = (
    await rpc.call<Record<string, any>>("orchestration.getThreadProjection", { threadId })
  ).value;
  const view = projection.projection ?? projection;
  const counts: Record<string, number> = {};
  for (const item of view.turnItems ?? view.items ?? []) {
    const type = String(item.type ?? item.kind ?? "unknown");
    counts[type] = (counts[type] ?? 0) + 1;
    // A failed turn's error item says why; keep it next to the counts.
    if (type === "error") counts[`error: ${JSON.stringify(item).slice(-800)}`] = 1;
  }
  return counts;
}

async function createThread(session: Session, rpc: WsRpc, label: string) {
  const root = NodePath.join(t3Home, "repos", label);
  makeScratchRepo(root);
  const projectId = NodeCrypto.randomUUID();
  const created = await fetch(`${session.server.origin}/api/projects/mutate`, {
    method: "POST",
    headers: { ...session.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "project.create",
      commandId: NodeCrypto.randomUUID(),
      projectId,
      title: `PoH 04c ${label}`,
      workspaceRoot: root,
    }),
  });
  if (!created.ok)
    throw new Error(`project create failed: ${created.status} ${await created.text()}`);
  const threadId = NodeCrypto.randomUUID();
  const options = (args.option ?? []).map((entry) => {
    const at = entry.indexOf("=");
    const raw = entry.slice(at + 1);
    return { id: entry.slice(0, at), value: raw === "true" ? true : raw === "false" ? false : raw };
  });
  await rpc.call("orchestration.launchThread", {
    commandId: NodeCrypto.randomUUID(),
    threadId,
    projectId,
    title: `PoH 04c ${label}`,
    generateTitle: false,
    modelSelection: {
      instanceId: args.instance,
      model: args.model,
      ...(options.length > 0 ? { options } : {}),
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
  });
  return threadId;
}

/** One measured unit: `tasks.length` threads dispatched together, measured until writes drain. */
async function measureUnit(
  session: Session,
  dbPath: string,
  unit: number,
  tasks: ReadonlyArray<(typeof TASKS)[number]>,
) {
  const server = session.server;
  const setup = await connect(session);
  const threads: Array<{ task: (typeof TASKS)[number]; threadId: string; rpc: WsRpc }> = [];
  for (const [index, task] of tasks.entries()) {
    const threadId = await createThread(session, setup, `u${unit}-${index}-${task.id}`);
    threads.push({ task, threadId, rpc: await connect(session) });
  }
  const watches = threads.map((thread) => watchThread(thread.rpc, thread.threadId));
  await Promise.all(watches.map((watch) => watch.ready));
  // Setup writes (project, thread, launch) must not count toward the turn.
  await drain(server.pid, dbPath);
  const sequenceBefore = maxSequence(dbPath);
  const tapBefore = readIoTap(ioTapDir, server.pid);
  const procBefore = sampleTree(server.pid);
  let peakRss = procBefore.serverRss;
  const rssTimer = setInterval(() => {
    peakRss = Math.max(peakRss, sampleTree(server.pid).serverRss);
  }, 50);
  const dispatchedAt = Date.now();
  const failures: Array<string> = [];
  await Promise.all(
    threads.map((thread) =>
      thread.rpc.call("orchestration.dispatchCommand", {
        type: "message.dispatch",
        commandId: NodeCrypto.randomUUID(),
        threadId: thread.threadId,
        messageId: NodeCrypto.randomUUID(),
        text: thread.task.text,
        attachments: [],
        createdBy: "user",
        creationSource: "web",
        dispatchMode: { type: "start_immediately" },
      }),
    ),
  );
  const settledResults = await Promise.allSettled(watches.map((watch) => watch.settled));
  for (const [index, result] of settledResults.entries()) {
    if (result.status === "rejected")
      failures.push(`${threads[index]!.task.id}: ${String(result.reason)}`);
  }
  // RSS sampling continues through the drain: trailing writes belong to this unit.
  const settledAt = Date.now();
  const drainMs = await drain(server.pid, dbPath);
  clearInterval(rssTimer);
  const procAfter = sampleTree(server.pid);
  peakRss = Math.max(peakRss, procAfter.serverRss);
  const io = diffIoTap(tapBefore, readIoTap(ioTapDir, server.pid)) as IoTap | undefined;
  const events = eventsSince(
    dbPath,
    sequenceBefore,
    threads.map((thread) => thread.threadId),
  );
  const turns = [];
  for (const [index, thread] of threads.entries()) {
    const watch = watches[index]!;
    turns.push({
      task: thread.task.id,
      threadId: thread.threadId,
      status: [...watch.runs.values()].at(-1) ?? "none",
      runs: watch.runs.size,
      wallMs: (watch.settledAt() || settledAt) - dispatchedAt,
      eventsStored: events.byThread[thread.threadId] ?? 0,
      items: await itemCounts(setup, thread.threadId).catch(() => null),
      live: summarizeArrivals(watch.arrivals, dispatchedAt),
      ...(watch.lastRun()?.status === "completed"
        ? {}
        : { lastRun: JSON.stringify(watch.lastRun() ?? null).slice(0, 4000) }),
    });
  }
  // Archive detaches each thread's provider session, so finished CLIs do not pile up in memory.
  for (const thread of threads) {
    await setup
      .call("orchestration.dispatchCommand", {
        type: "thread.archive",
        commandId: NodeCrypto.randomUUID(),
        threadId: thread.threadId,
      })
      .catch((error: unknown) => log(`archive ${thread.threadId} failed: ${String(error)}`));
    await thread.rpc.close();
  }
  await setup.close();
  const sample = {
    kind: "unit",
    shape: args.shape,
    unit,
    threads: threads.length,
    tasks: tasks.map((task) => task.id),
    instance: args.instance,
    model: args.model,
    options: args.option,
    wallMs: settledAt - dispatchedAt,
    drainMs,
    io,
    events: events.total,
    eventPayloadBytes: events.payloadBytes,
    eventsByType: events.byType,
    cpuS: procAfter.serverCpuS - procBefore.serverCpuS,
    peakRss,
    failures,
    turns,
  };
  record(sample);
  const mib = io === undefined ? NaN : (io.walBytes + io.dbBytes + io.journalBytes) / 2 ** 20;
  log(
    `unit ${unit} [${sample.tasks.join(",")}] ${turns.map((t) => t.status).join(",")} wall ${Math.round(sample.wallMs)}ms events ${events.total} commits ${io?.walCommits} sqlite ${mib.toFixed(2)}MiB${failures.length > 0 ? ` FAIL ${failures.join("; ")}` : ""}`,
  );
  return sample;
}

const results: Record<string, unknown> = {
  sha,
  seed: args.seed,
  serverEnv: { ...serverEnv, LD_PRELOAD: serverEnv.LD_PRELOAD === undefined ? undefined : "iotap" },
  shape: args.shape,
  instance: args.instance,
  model: args.model,
  options: args.option,
  settings: args.settings,
  startedAt: new Date().toISOString(),
  cli: cliVersions(),
  host: {
    cpus: (await import("node:os")).availableParallelism(),
    totalMem: (await import("node:os")).totalmem(),
    hostname: (await import("node:os")).hostname(),
  },
};
log(
  `sha ${sha}; out ${out}; ${args.instance}/${args.model} ${args.shape} env ${JSON.stringify(results.serverEnv)}`,
);
const prepared = prepareHome({ seed: args.seed, t3Home });
log(`bench home ${t3Home} (disabled scheduled tasks: ${prepared.disabledScheduledTasks})`);
if (args.settings !== undefined) {
  // $PROVIDER_BIN names the wrapper directory, for ACP instances that need an absolute command.
  NodeFS.writeFileSync(
    NodePath.join(t3Home, "userdata", "settings.json"),
    args.settings.replaceAll("$PROVIDER_BIN", NodePath.join(t3Home, "provider-bin")),
  );
}
let server: RunningServer | undefined;
try {
  server = await startServer({
    t3Home,
    benchHome,
    env: { ...serverEnv, PATH: providerPath() },
    logPath: NodePath.join(out, "server.log"),
  });
  const session = await authenticate(server);
  const rpc = await connect(session);
  const { providers, target } = await providerSnapshot(
    rpc,
    args.probe ? undefined : args.instance,
    120_000,
    args.probe ? undefined : args.model,
  );
  if (args.probe) {
    // Give the probes time to finish before describing them.
    await providerSnapshot(rpc, "claudeAgent").catch((error: unknown) => log(String(error)));
    await providerSnapshot(rpc, "codex").catch((error: unknown) => log(String(error)));
    await providerSnapshot(rpc, "grok", 30_000).catch((error: unknown) => log(String(error)));
    await providerSnapshot(rpc, "hermes", 90_000).catch((error: unknown) => log(String(error)));
    const settled = (await rpc.call<Record<string, any>>("server.getConfig", {})).value;
    NodeFS.writeFileSync(
      NodePath.join(out, "providers.json"),
      JSON.stringify(describeProviders(settled.providers ?? providers), null, 1),
    );
    log(`providers written`);
  } else {
    results.provider = describeProviders([target!])[0];
    if (!(target!.models ?? []).some((m: Record<string, any>) => m.slug === args.model)) {
      throw new Error(`model ${args.model} not offered by ${args.instance}`);
    }
    await rpc.close();
    const offset = Number(args["batch-offset"]);
    if (args.shape === "s1") {
      for (const [index, task] of TASKS.entries())
        await measureUnit(session, prepared.db, index, [task]);
    } else if (args.shape === "s4") {
      for (let b = 0; b < Number(args.batches); b++) {
        const g = offset + b;
        const tasks = [0, 1, 2, 3].map((k) => TASKS[(g + k) % TASKS.length]!);
        await measureUnit(session, prepared.db, g, tasks);
      }
    } else {
      throw new Error(`unknown shape ${args.shape}`);
    }
  }
  results.finishedAt = new Date().toISOString();
  NodeFS.writeFileSync(NodePath.join(out, "run.json"), JSON.stringify(results, null, 2));
  log(`done: ${out}`);
} finally {
  await server?.stop();
  if (!args["keep-home"]) NodeFS.rmSync(t3Home, { recursive: true, force: true });
}
