// Turns a bench output dir (samples.ndjson, durable-*.json, run.json) into a markdown report and
// ledger rows. Usage: node bench/poh/report.ts --in <dir> [--md <file>] [--ledger <file>] [--experiment 00-baseline]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const { values: args } = NodeUtil.parseArgs({
  options: {
    in: { type: "string", multiple: true },
    md: { type: "string" },
    ledger: { type: "string" },
    experiment: { type: "string", default: "00-baseline" },
  },
});
const dirs = (args.in ?? []).map((d) => NodePath.resolve(d));
if (dirs.length === 0) throw new Error("--in <dir> required");

type Sample = Record<string, any>;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  // Nearest-rank.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

interface Metric {
  metric: string;
  unit: "ms" | "bytes" | "s" | "count";
  values: number[];
}

function metricsFor(samples: Sample[]): Metric[] {
  const metrics: Metric[] = [];
  const add = (metric: string, unit: Metric["unit"], values: number[]) => {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length > 0) metrics.push({ metric, unit, values: finite });
  };
  const of = (kind: string, filter: (s: Sample) => boolean = () => true) =>
    samples.filter((s) => s.kind === kind && filter(s));
  const boots = of("boot", (s) => s.boot > 0);
  add(
    "startup.migrate_boot.ms",
    "ms",
    of("boot", (s) => s.boot === 0).map((s) => s.startupMs),
  );
  add(
    "startup.ready.ms",
    "ms",
    boots.map((s) => s.startupMs),
  );
  add(
    "server.idle_rss.bytes",
    "bytes",
    boots.map((s) => s.idleRss),
  );
  add(
    "server.idle_tree_rss.bytes",
    "bytes",
    boots.map((s) => s.idleTreeRss),
  );
  add(
    "server.boot_cpu.s",
    "s",
    boots.map((s) => s.bootCpuS),
  );
  add(
    "ws.connect.ms",
    "ms",
    of("ws-connect").map((s) => s.ms),
  );
  for (const temp of ["cold", "warm"]) {
    const rows = of("sidebar", (s) => s.temp === temp);
    add(
      `sidebar.${temp}.ms`,
      "ms",
      rows.map((s) => s.ms),
    );
    add(
      `sidebar.${temp}.http_ms`,
      "ms",
      rows.map((s) => s.httpMs),
    );
    add(
      `sidebar.${temp}.ws_ms`,
      "ms",
      rows.map((s) => s.wsMs),
    );
    add(
      `sidebar.${temp}.cpu.s`,
      "s",
      rows.map((s) => s.cpuS),
    );
  }
  add(
    "sidebar.http.bytes",
    "bytes",
    of("sidebar").map((s) => s.httpBytes),
  );
  add(
    "sidebar.ws.bytes",
    "bytes",
    of("sidebar").map((s) => s.wsBytes),
  );
  add(
    "sidebar.threads.count",
    "count",
    of("sidebar").map((s) => s.threads),
  );
  for (const size of ["small", "median", "largest"]) {
    for (const temp of ["cold", "warm"]) {
      const rows = of("thread-open", (s) => s.size === size && s.temp === temp);
      add(
        `thread_open.${size}.${temp}.ms`,
        "ms",
        rows.map((s) => s.ms),
      );
      add(
        `thread_open.${size}.${temp}.http_ms`,
        "ms",
        rows.map((s) => s.httpMs),
      );
      add(
        `thread_open.${size}.${temp}.ws_ms`,
        "ms",
        rows.map((s) => s.wsMs),
      );
      add(
        `thread_open.${size}.${temp}.cpu.s`,
        "s",
        rows.map((s) => s.cpuS),
      );
    }
    const rows = of("thread-open", (s) => s.size === size);
    add(
      `thread_open.${size}.http.bytes`,
      "bytes",
      rows.map((s) => s.httpBytes),
    );
    add(
      `thread_open.${size}.ws.bytes`,
      "bytes",
      rows.map((s) => s.wsBytes),
    );
    const socket = of("thread-open-socket", (s) => s.size === size);
    add(
      `thread_open_socket_only.${size}.ms`,
      "ms",
      socket.map((s) => s.ms),
    );
    add(
      `thread_open_socket_only.${size}.ws.bytes`,
      "bytes",
      socket.map((s) => s.wsBytes),
    );
    add(
      `thread_open_socket_only.${size}.cpu.s`,
      "s",
      socket.map((s) => s.cpuS),
    );
    const full = of("thread-full-http", (s) => s.size === size);
    add(
      `thread_full_http.${size}.ms`,
      "ms",
      full.map((s) => s.ms),
    );
    add(
      `thread_full_http.${size}.bytes`,
      "bytes",
      full.map((s) => s.httpBytes),
    );
    add(
      `thread_full_http.${size}.client_parse_ms`,
      "ms",
      full.map((s) => s.parseMs),
    );
  }
  const idle = of("reconnect-idle");
  add(
    "reconnect.idle.ms",
    "ms",
    idle.map((s) => s.ms),
  );
  add(
    "reconnect.idle.ws.bytes",
    "bytes",
    idle.map((s) => s.wsBytes),
  );
  add(
    "reconnect.idle.http.bytes",
    "bytes",
    idle.map((s) => s.httpBytes),
  );
  add(
    "reconnect.idle.cpu.s",
    "s",
    idle.map((s) => s.cpuS),
  );
  const missed = of("reconnect-missed-turn");
  add(
    "reconnect.missed_turn.ms",
    "ms",
    missed.map((s) => s.ms),
  );
  add(
    "reconnect.missed_turn.ws.bytes",
    "bytes",
    missed.map((s) => s.wsBytes),
  );
  add(
    "reconnect.missed_turn.thread_ws.bytes",
    "bytes",
    missed.map((s) => s.threadWsBytes),
  );
  add(
    "reconnect.missed_turn.http.bytes",
    "bytes",
    missed.map((s) => s.httpBytes),
  );
  add(
    "reconnect.missed_turn.replayed_events.count",
    "count",
    missed.map((s) => s.threadKinds?.event ?? 0),
  );
  const turns = of("turn");
  add(
    "turn.sim.ms",
    "ms",
    turns.map((s) => s.ms),
  );
  add(
    "turn.sim.db_used_delta.bytes",
    "bytes",
    turns.map((s) => s.dbUsedDelta),
  );
  add(
    "turn.sim.thread_payload_delta.bytes",
    "bytes",
    turns.map((s) => s.threadBytesDelta),
  );
  add(
    "turn.sim.cpu.s",
    "s",
    turns.filter((s) => s.cpuS !== undefined).map((s) => s.cpuS),
  );
  const peaks = new Map<number, number>();
  for (const s of samples) {
    if (typeof s.peakRss === "number")
      peaks.set(s.boot, Math.max(peaks.get(s.boot) ?? 0, s.peakRss));
  }
  add(
    "server.peak_rss_per_boot.bytes",
    "bytes",
    [...peaks.entries()].filter(([b]) => b > 0).map(([, v]) => v),
  );
  add(
    "server.end_rss_per_boot.bytes",
    "bytes",
    of("boot-end").map((s) => s.rss),
  );
  add(
    "server.tree_cpu_per_boot.s",
    "s",
    of("boot-end").map((s) => s.treeCpuS),
  );
  return metrics;
}

const fmt = (unit: Metric["unit"], v: number) => {
  if (!Number.isFinite(v)) return "n/a";
  if (unit === "bytes") {
    if (Math.abs(v) >= 2 ** 20) return `${(v / 2 ** 20).toFixed(1)} MiB`;
    if (Math.abs(v) >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
    return `${Math.round(v)} B`;
  }
  if (unit === "ms") return v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
  if (unit === "s") return `${v.toFixed(2)} s`;
  return String(Math.round(v));
};

const sections: string[] = [];
const ledgerRows: string[] = [];
for (const dir of dirs) {
  const samples = NodeFS.readFileSync(NodePath.join(dir, "samples.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sample);
  const run = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "run.json"), "utf8"));
  const durable = JSON.parse(
    NodeFS.readFileSync(NodePath.join(dir, "durable-before.json"), "utf8"),
  );
  const metrics = metricsFor(samples);
  const at = run.finishedAt ?? new Date().toISOString();
  for (const m of metrics) {
    ledgerRows.push(
      JSON.stringify({
        experiment: args.experiment,
        sha: run.sha,
        flag: "n/a (baseline)",
        metric: m.metric,
        unit: m.unit,
        n: m.values.length,
        p50: percentile(m.values, 50),
        p95: percentile(m.values, 95),
        raw: NodePath.join(dir, "samples.ndjson"),
        at,
      }),
    );
  }
  const lines: string[] = [];
  lines.push(`### Run \`${NodePath.basename(dir)}\``, "");
  lines.push(
    `SHA \`${run.sha}\`${run.dirty ? " (dirty outside bench/)" : ""}; ${run.runs} cold boots + 1 migration boot, ${run.warm} warm repeats per boot; node ${run.node}; ${run.host.cpus} CPUs, ${(run.host.totalMem / 2 ** 30).toFixed(0)} GiB RAM. ${run.startedAt} → ${run.finishedAt}. Raw: \`${dir}\`.`,
    "",
  );
  lines.push("Threads (picked by durable bytes after migration, among threads with messages):", "");
  lines.push(
    "| pick | thread | durable bytes | events | messages | turn items |",
    "|---|---|---|---|---|---|",
  );
  for (const [size, t] of Object.entries(run.picks as Record<string, any>)) {
    lines.push(
      `| ${size} | \`${t.threadId.slice(0, 48)}\` | ${fmt("bytes", t.bytes)} | ${t.events} | ${t.messages} | ${t.turnItems} |`,
    );
  }
  lines.push("", "| metric | n | p50 | p95 | min | max |", "|---|---|---|---|---|---|");
  for (const m of metrics) {
    lines.push(
      `| ${m.metric} | ${m.values.length} | ${fmt(m.unit, percentile(m.values, 50))} | ${fmt(m.unit, percentile(m.values, 95))} | ${fmt(m.unit, Math.min(...m.values))} | ${fmt(m.unit, Math.max(...m.values))} |`,
    );
  }
  lines.push("", "#### Durable bytes (seeded DB after this SHA's migrations)", "");
  lines.push(
    `DB file ${fmt("bytes", durable.fileBytes.db)} (${durable.pageCount} pages × ${durable.pageSize} B, ${durable.freelistCount} free). Threads: ${durable.threadSummary.count}; attributed payload ${fmt("bytes", durable.threadSummary.total)}; per thread p50 ${fmt("bytes", durable.threadSummary.p50)}, p90 ${fmt("bytes", durable.threadSummary.p90)}, max ${fmt("bytes", durable.threadSummary.max)}; deleted/unknown-thread payload ${fmt("bytes", durable.threadSummary.unattributedBytes)}.`,
    "",
  );
  lines.push("| table | rows | table bytes | index bytes |", "|---|---|---|---|");
  for (const t of durable.tables.filter((t: any) => t.tableBytes + t.indexBytes >= 64 * 1024)) {
    lines.push(
      `| ${t.table} | ${t.rows} | ${fmt("bytes", t.tableBytes)} | ${fmt("bytes", t.indexBytes)} |`,
    );
  }
  lines.push("", "Top threads by durable payload bytes (event log + projections):", "");
  const hasRuns = durable.threads.some((t: any) => typeof t.runs === "number");
  lines.push(
    `| thread | archived | total | event log | projections | events | messages | turn items |${hasRuns ? " runs | bytes/run |" : ""}`,
    `|---|---|---|---|---|---|---|---|${hasRuns ? "---|---|" : ""}`,
  );
  for (const t of durable.threads.slice(0, 10)) {
    lines.push(
      `| \`${t.threadId.slice(0, 40)}\` | ${t.archived ? "yes" : "no"} | ${fmt("bytes", t.bytes)} | ${fmt("bytes", t.eventBytes)} | ${fmt("bytes", t.projectionBytes)} | ${t.events} | ${t.messages} | ${t.turnItems} |${hasRuns ? ` ${t.runs} | ${t.runs ? fmt("bytes", t.bytes / t.runs) : "n/a"} |` : ""}`,
    );
  }
  const sorted = [...durable.threads].sort((a: any, b: any) => a.bytes - b.bytes);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median) {
    lines.push(
      `| median: \`${median.threadId.slice(0, 32)}\` | ${median.archived ? "yes" : "no"} | ${fmt("bytes", median.bytes)} | ${fmt("bytes", median.eventBytes)} | ${fmt("bytes", median.projectionBytes)} | ${median.events} | ${median.messages} | ${median.turnItems} |${hasRuns ? ` ${median.runs} | ${median.runs ? fmt("bytes", median.bytes / median.runs) : "n/a"} |` : ""}`,
    );
  }
  if (hasRuns) {
    const withRuns = durable.threads.filter((t: any) => t.runs > 0);
    const perRun = withRuns.map((t: any) => t.bytes / t.runs);
    lines.push(
      "",
      `Durable bytes per run across ${withRuns.length} threads with runs: p50 ${fmt("bytes", percentile(perRun, 50))}, p95 ${fmt("bytes", percentile(perRun, 95))}.`,
    );
  }
  lines.push(
    "",
    "Thread event log by event type:",
    "",
    "| event type | events | payload bytes |",
    "|---|---|---|",
  );
  for (const e of durable.threadEventTypes.slice(0, 12)) {
    lines.push(`| ${e.eventType} | ${e.events} | ${fmt("bytes", e.bytes)} |`);
  }
  sections.push(lines.join("\n"));
}

const output = sections.join("\n\n");
if (args.md) {
  NodeFS.writeFileSync(args.md, output + "\n");
  console.log(`wrote ${args.md}`);
} else {
  console.log(output);
}
if (args.ledger) {
  NodeFS.appendFileSync(args.ledger, ledgerRows.join("\n") + "\n");
  console.log(`appended ${ledgerRows.length} rows to ${args.ledger}`);
}
