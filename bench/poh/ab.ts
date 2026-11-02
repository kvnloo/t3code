// PoH A/B: pools bench runs per arm (flag off vs on, same SHA) and compares p50/p95 against the
// within-arm spread between rounds. Usage:
//   node bench/poh/ab.ts --off <dir> --off <dir> --on <dir> --on <dir> [--md f] [--ledger f]
//     [--experiment 02-snapshot-fold] [--flag-name T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { fmt, type Metric, metricsFor, percentile, type Sample } from "./metrics.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    off: { type: "string", multiple: true },
    on: { type: "string", multiple: true },
    md: { type: "string" },
    ledger: { type: "string" },
    experiment: { type: "string", default: "ab" },
    "flag-name": { type: "string", default: "flag" },
  },
});
const arms = { off: args.off ?? [], on: args.on ?? [] };
if (arms.off.length === 0 || arms.on.length === 0) throw new Error("--off and --on required");

function load(dir: string) {
  const samples = NodeFS.readFileSync(NodePath.join(dir, "samples.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Sample);
  const run = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "run.json"), "utf8"));
  const durable = JSON.parse(
    NodeFS.readFileSync(NodePath.join(dir, "durable-before.json"), "utf8"),
  );
  const after = JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "durable-after.json"), "utf8"));
  // Durable size is deterministic per seed; one value per run.
  const extra: Metric[] = [
    { metric: "durable.db_file.bytes", unit: "bytes", values: [durable.fileBytes.db] },
    {
      metric: "durable.used.bytes",
      unit: "bytes",
      values: [(durable.pageCount - durable.freelistCount) * durable.pageSize],
    },
    {
      metric: "durable.thread_payload.p50.bytes",
      unit: "bytes",
      values: [durable.threadSummary.p50],
    },
    {
      metric: "durable.thread_payload.max.bytes",
      unit: "bytes",
      values: [durable.threadSummary.max],
    },
    {
      metric: "durable.used_after_run.bytes",
      unit: "bytes",
      values: [(after.pageCount - after.freelistCount) * after.pageSize],
    },
  ];
  return { dir, run, metrics: [...metricsFor(samples), ...extra] };
}

const loaded = { off: arms.off.map(load), on: arms.on.map(load) };
const shas = new Set([...loaded.off, ...loaded.on].map((r) => r.run.sha));
if (shas.size !== 1) throw new Error(`arms ran different SHAs: ${[...shas].join(", ")}`);
const sha = [...shas][0];

function pooled(runs: typeof loaded.off, metric: string) {
  const values = runs.flatMap((r) => r.metrics.find((m) => m.metric === metric)?.values ?? []);
  const unit = runs.flatMap((r) => r.metrics.filter((m) => m.metric === metric))[0]?.unit;
  return { values, unit };
}

const names = [...new Set(loaded.off.flatMap((r) => r.metrics.map((m) => m.metric)))];
const rows: string[] = [];
const ledgerRows: string[] = [];
const at = new Date().toISOString();
rows.push(
  `| metric | n off/on | off p50 | on p50 | Δ p50 | off p95 | on p95 | noise (p50 spread between rounds) | verdict |`,
  "|---|---|---|---|---|---|---|---|---|",
);
for (const name of names) {
  const off = pooled(loaded.off, name);
  const on = pooled(loaded.on, name);
  if (off.values.length === 0 || on.values.length === 0 || off.unit === undefined) continue;
  const unit = off.unit;
  const p50Off = percentile(off.values, 50);
  const p50On = percentile(on.values, 50);
  // Noise: largest p50 spread between rounds of the same arm.
  const spread = (runs: typeof loaded.off) => {
    const p50s = runs
      .map((r) => r.metrics.find((m) => m.metric === name)?.values ?? [])
      .filter((v) => v.length > 0)
      .map((v) => percentile(v, 50));
    return p50s.length < 2 ? 0 : Math.max(...p50s) - Math.min(...p50s);
  };
  const noise = Math.max(spread(loaded.off), spread(loaded.on));
  const delta = p50On - p50Off;
  const deterministic = noise === 0 && off.values.every((v) => v === off.values[0]);
  const verdict =
    delta === 0
      ? "none (identical)"
      : Math.abs(delta) <= noise
        ? "none (within noise)"
        : delta < 0
          ? deterministic
            ? "improvement (deterministic)"
            : "improvement"
          : deterministic
            ? "regression (deterministic)"
            : "regression";
  const pct = p50Off === 0 ? "" : ` (${((delta / p50Off) * 100).toFixed(1)}%)`;
  rows.push(
    `| ${name} | ${off.values.length}/${on.values.length} | ${fmt(unit, p50Off)} | ${fmt(unit, p50On)} | ${delta >= 0 ? "+" : ""}${fmt(unit, delta)}${pct} | ${fmt(unit, percentile(off.values, 95))} | ${fmt(unit, percentile(on.values, 95))} | ${fmt(unit, noise)} | ${verdict} |`,
  );
  for (const [arm, data] of [
    ["off", off],
    ["on", on],
  ] as const) {
    ledgerRows.push(
      JSON.stringify({
        experiment: args.experiment,
        sha,
        flag: `${args["flag-name"]}=${arm === "on" ? "1" : "unset"}`,
        metric: name,
        unit,
        n: data.values.length,
        p50: percentile(data.values, 50),
        p95: percentile(data.values, 95),
        noise,
        verdict,
        raw: (arm === "on" ? arms.on : arms.off).map((d) => NodePath.join(d, "samples.ndjson")),
        at,
      }),
    );
  }
}
const header = [
  `SHA \`${sha}\`. Off runs: ${arms.off.map((d) => `\`${NodePath.basename(d)}\``).join(", ")}. On runs: ${arms.on.map((d) => `\`${NodePath.basename(d)}\``).join(", ")}.`,
  "",
];
const output = [...header, ...rows].join("\n");
if (args.md) NodeFS.writeFileSync(args.md, output + "\n");
console.log(output);
if (args.ledger) {
  NodeFS.appendFileSync(args.ledger, ledgerRows.join("\n") + "\n");
  console.log(`appended ${ledgerRows.length} rows to ${args.ledger}`);
}
