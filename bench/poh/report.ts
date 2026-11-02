// Turns a bench output dir (samples.ndjson, durable-*.json, run.json) into a markdown report and
// ledger rows. Usage: node bench/poh/report.ts --in <dir> [--md <file>] [--ledger <file>] [--experiment 00-baseline]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { fmt, metricsFor, percentile, type Sample } from "./metrics.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    in: { type: "string", multiple: true },
    md: { type: "string" },
    ledger: { type: "string" },
    experiment: { type: "string", default: "00-baseline" },
    flag: { type: "string", default: "n/a (baseline)" },
  },
});
const dirs = (args.in ?? []).map((d) => NodePath.resolve(d));
if (dirs.length === 0) throw new Error("--in <dir> required");

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
        flag: args.flag,
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
