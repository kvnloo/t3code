// Summarizes fold-pass.ts runs: probe (writer commit) and turn latency by window of the pass.
// Off runs take the window bounds of the on run they are paired with (--pair off=on, by order).
// Usage: node bench/poh/fold-pass-report.ts --off <dir>... --on <dir>... [--md f] [--ledger f]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { percentile } from "./metrics.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    off: { type: "string", multiple: true, default: [] },
    on: { type: "string", multiple: true, default: [] },
    md: { type: "string" },
    ledger: { type: "string" },
  },
});
const load = (dir: string) => ({
  dir,
  run: JSON.parse(NodeFS.readFileSync(NodePath.join(dir, "run.json"), "utf8")),
  samples: NodeFS.readFileSync(NodePath.join(dir, "samples.ndjson"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>),
});
const on = args.on!.map(load);
const off = args.off!.map(load);
if (on.length === 0 || off.length !== on.length) throw new Error("pair each --off with an --on");
for (const r of on) if (r.run.pass.foldEnd === undefined) throw new Error(`${r.dir}: no fold end`);

// Windows (ms since spawn): compaction (1 min timer to fold start), fold, after.
const windowsOf = (r: (typeof on)[number]) => ({
  before: [0, 60_000],
  compaction: [60_000, r.run.pass.foldStart],
  fold: [r.run.pass.foldStart, r.run.pass.foldEnd],
  after: [r.run.pass.foldEnd, Infinity],
});
type Window = keyof ReturnType<typeof windowsOf>;
const WINDOWS: Window[] = ["before", "compaction", "fold", "after"];

const collect = (runs: typeof on, pairs: typeof on, window: Window) => {
  const probes: number[] = [];
  const turns: number[] = [];
  runs.forEach((r, i) => {
    const [lo, hi] = windowsOf(pairs[i]!)[window];
    for (const s of r.samples) {
      if (s.kind === "probe" && s.at >= lo && s.at < hi) probes.push(s.ms);
      // A turn counts for a window if it overlaps it.
      if (s.kind === "turn" && s.at < hi && s.end > lo) turns.push(s.ms);
    }
  });
  return { probes, turns };
};
const stat = (values: number[]) =>
  values.length === 0
    ? "n 0"
    : `n ${values.length}, p50 ${percentile(values, 50).toFixed(1)}, p95 ${percentile(values, 95).toFixed(1)}, max ${Math.max(...values).toFixed(0)}`;

const lines = [
  `On: ${on.map((r) => NodePath.basename(r.dir)).join(", ")}. Off: ${off.map((r) => NodePath.basename(r.dir)).join(", ")}. SHA ${on[0]!.run.sha}.`,
  "",
  "| run | fold start | fold wall | pass log: entities / events / transactions / longest tx / passMillis |",
  "|---|---|---|---|",
  ...on.map(
    (r) =>
      `| ${NodePath.basename(r.dir)} | ${(r.run.pass.foldStart / 1000).toFixed(0)} s | ${((r.run.pass.foldEnd - r.run.pass.foldStart) / 1000).toFixed(1)} s | ${r.run.foldLog === null ? "none" : `${r.run.foldLog.foldedEntityCount} / ${r.run.foldLog.deletedEventCount} / ${r.run.foldLog.transactionCount} / ${r.run.foldLog.longestTransactionMillis} ms / ${r.run.foldLog.passMillis} ms`} |`,
  ),
  "",
  "| window | arm | write probe ms (thread.visit commit) | turn wall ms (devReplay, overlapping) |",
  "|---|---|---|---|",
];
const ledger: string[] = [];
for (const window of WINDOWS) {
  for (const [arm, runs] of [
    ["off", off],
    ["on", on],
  ] as const) {
    const { probes, turns } = collect(runs, on, window);
    lines.push(`| ${window} | ${arm} | ${stat(probes)} | ${stat(turns)} |`);
    for (const [metric, values] of [
      [`fold_pass.${window}.probe.ms`, probes],
      [`fold_pass.${window}.turn.ms`, turns],
    ] as const) {
      if (values.length === 0) continue;
      ledger.push(
        JSON.stringify({
          experiment: "02-snapshot-fold-r3-pass",
          sha: on[0]!.run.sha,
          flag: `T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD=${arm === "on" ? "1" : "unset"}`,
          metric,
          unit: "ms",
          n: values.length,
          p50: percentile(values, 50),
          p95: percentile(values, 95),
          max: Math.max(...values),
          raw: runs.map((r) => NodePath.join(r.dir, "samples.ndjson")),
          at: new Date().toISOString(),
        }),
      );
    }
  }
}
const output = lines.join("\n");
console.log(output);
if (args.md) NodeFS.writeFileSync(args.md, output + "\n");
if (args.ledger) NodeFS.appendFileSync(args.ledger, ledger.join("\n") + "\n");
