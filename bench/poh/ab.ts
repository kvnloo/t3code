// PoH A/B: pooled p50/p95 per arm (flag off vs on, same SHA) against the between-round spread, plus
// for latency a rank test over adjacent off/on round pairs deflated by same-arm round drift, and a
// power check (same-arm pairs, later round shifted by --power-shift-ms). Usage: node bench/poh/ab.ts
//   --off <dir>... --on <dir>... [--md f] [--ledger f] [--experiment e] [--flag-name F] [--alpha a]
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
    "power-shift-ms": { type: "string", default: "109" },
    alpha: { type: "string", default: "0.05" },
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

const POWER_SHIFT_MS = Number(args["power-shift-ms"]);
const ALPHA = Number(args.alpha);

// Abramowitz-Stegun 7.1.26; |error| < 1.5e-7, enough for a p-value.
function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const twoSidedP = (z: number) => Math.max(0, Math.min(1, 1 - erf(Math.abs(z) / Math.SQRT2)));

/** Mann-Whitney z (normal approximation, tie-corrected); positive when `b` is larger. */
function mannWhitneyZ(a: number[], b: number[]) {
  const all = [...a.map((v) => ({ v, b: false })), ...b.map((v) => ({ v, b: true }))].sort(
    (x, y) => x.v - y.v,
  );
  const n = all.length;
  let rankB = 0;
  let ties = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++;
    for (let k = i; k <= j; k++) if (all[k]!.b) rankB += (i + j + 2) / 2;
    const t = j - i + 1;
    ties += t * t * t - t;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const u = rankB - (n2 * (n2 + 1)) / 2;
  const variance = ((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1)));
  return variance <= 0 ? 0 : (u - (n1 * n2) / 2) / Math.sqrt(variance);
}

/**
 * Stouffer-combined rank test over round pairs; each pair is (earlier, later) sample sets. `phi`
 * deflates z for drift between rounds: the mean squared per-pair z of the null pairs (at least 1).
 */
function pairedP(pairs: Array<readonly [number[], number[]]>, phi = 1) {
  const usable = pairs.filter(([x, y]) => x.length > 0 && y.length > 0);
  if (usable.length === 0) return null;
  const zs = usable.map(([x, y]) => mannWhitneyZ(x, y));
  const z = zs.reduce((sum, value) => sum + value, 0) / Math.sqrt(usable.length) / Math.sqrt(phi);
  return { z, p: twoSidedP(z), zs };
}

const loaded = { off: arms.off.map(load), on: arms.on.map(load) };
// Rounds in run order. Adjacent off/on rounds form the A/B pairs, so slow host drift between
// pairs cancels. Adjacent same-arm rounds (ABBA gives off,off and on,on) are the null control:
// the method must not flag them, and must flag them once the later one is shifted by
// --power-shift-ms. That is the power the A/B has at this host load.
const ordered = [
  ...loaded.off.map((r) => ({ ...r, arm: "off" as const })),
  ...loaded.on.map((r) => ({ ...r, arm: "on" as const })),
].sort((x, y) => String(x.run.startedAt).localeCompare(String(y.run.startedAt)));
const abPairs: Array<{ off: (typeof ordered)[number]; on: (typeof ordered)[number] }> = [];
const nullPairs: Array<readonly [(typeof ordered)[number], (typeof ordered)[number]]> = [];
for (let i = 0; i + 1 < ordered.length; i++) {
  const x = ordered[i]!;
  const y = ordered[i + 1]!;
  if (x.arm === y.arm) nullPairs.push([x, y]);
}
for (let i = 0; i + 1 < ordered.length;) {
  const x = ordered[i]!;
  const y = ordered[i + 1]!;
  if (x.arm !== y.arm) {
    abPairs.push(x.arm === "off" ? { off: x, on: y } : { off: y, on: x });
    i += 2;
  } else i += 1;
}
const valuesOf = (run: (typeof ordered)[number], metric: string) =>
  run.metrics.find((m) => m.metric === metric)?.values ?? [];

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
  `| metric | n off/on | off p50 | on p50 | Δ p50 | off p95 | on p95 | noise (p50 spread between rounds) | verdict | paired rank p (on vs off, drift-calibrated) | null p (adjacent same-arm, raw) | power: calibrated p with +${POWER_SHIFT_MS} ms |`,
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
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
  const latency = unit === "ms";
  const nullRaw = latency
    ? pairedP(nullPairs.map(([x, y]) => [valuesOf(x, name), valuesOf(y, name)] as const))
    : null;
  // Rounds of one arm differ by more than sampling noise on a loaded host: calibrate on them.
  const phi =
    nullRaw === null
      ? 1
      : Math.max(1, nullRaw.zs.reduce((sum, z) => sum + z * z, 0) / nullRaw.zs.length);
  const ab = latency
    ? pairedP(
        abPairs.map(({ off: x, on: y }) => [valuesOf(x, name), valuesOf(y, name)] as const),
        phi,
      )
    : null;
  const nullTest = nullRaw;
  const shifted = latency
    ? pairedP(
        nullPairs.map(
          ([x, y]) =>
            [valuesOf(x, name), valuesOf(y, name).map((v) => v + POWER_SHIFT_MS)] as const,
        ),
        phi,
      )
    : null;
  const pCell = (test: ReturnType<typeof pairedP>) =>
    test === null ? "" : `${test.p.toExponential(1)} (z ${test.z.toFixed(1)})`;
  const abCell =
    ab === null
      ? ""
      : `${pCell(ab)}${ab.p < ALPHA ? " ✱" : ""}${phi > 1 ? `, φ ${phi.toFixed(1)}` : ""}`;
  const nullCell =
    nullTest === null
      ? ""
      : `${pCell(nullTest)}${nullTest.p < ALPHA ? " rounds drift (calibrated by φ)" : " ok"}`;
  const powerCell =
    shifted === null
      ? ""
      : `${pCell(shifted)}: ${shifted.p < ALPHA && shifted.z > 0 ? "detects" : "**cannot detect**"}`;
  rows.push(
    `| ${name} | ${off.values.length}/${on.values.length} | ${fmt(unit, p50Off)} | ${fmt(unit, p50On)} | ${delta >= 0 ? "+" : ""}${fmt(unit, delta)}${pct} | ${fmt(unit, percentile(off.values, 95))} | ${fmt(unit, percentile(on.values, 95))} | ${fmt(unit, noise)} | ${verdict} | ${abCell} | ${nullCell} | ${powerCell} |`,
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
        ...(ab === null
          ? {}
          : {
              driftPhi: phi,
              pairedRank: ab,
              nullRank: nullTest,
              power: { shiftMs: POWER_SHIFT_MS, alpha: ALPHA, ...shifted },
            }),
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
