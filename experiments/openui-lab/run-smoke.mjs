import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// Runs the lab tests against the stock OpenUI packages in an isolated scratch install.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? join(root, ".t3/openui-smoke"));
const scratch = mkdtempSync(join(tmpdir(), "t3-openui-smoke-"));
mkdirSync(out, { recursive: true });
const sources = {
  "OpenUiReport.tsx": "apps/web/src/components/chat/OpenUiReport.tsx",
  "OpenUiCharts.tsx": "apps/web/src/components/chat/OpenUiCharts.tsx",
  "openUiCharts.ts": "packages/client-runtime/src/openUiCharts.ts",
  "OpenUiAppCards.tsx": "apps/web/src/components/chat/OpenUiAppCards.tsx",
  "openUiAppCards.ts": "packages/client-runtime/src/openUiAppCards.ts",
  "appConnectors.ts": "packages/client-runtime/src/appConnectors.ts",
  "app-cards.test.ts": "experiments/openui-lab/app-cards.test.ts",
  "report.test.ts": "experiments/openui-lab/report.test.ts",
  "charts.test.ts": "experiments/openui-lab/charts.test.ts",
  "source-demo-fences.md": "experiments/openui-lab/source-demo-fences.md",
};
const rewrites = [
  ["../../apps/web/src/components/chat/OpenUiReport", "./OpenUiReport"],
  ["../../apps/web/src/components/chat/OpenUiCharts", "./OpenUiCharts"],
  ["@t3tools/client-runtime/openui-charts", "./openUiCharts"],
  ["@t3tools/client-runtime/openui-app-cards", "./openUiAppCards"],
  ["@t3tools/client-runtime/app-connectors", "./appConnectors"],
];
for (const [name, path] of Object.entries(sources)) {
  if (name.endsWith(".md")) {
    copyFileSync(join(root, path), join(scratch, name));
    continue;
  }
  let text = readFileSync(join(root, path), "utf8");
  for (const [from, to] of rewrites) text = text.replaceAll(`"${from}"`, `"${to}"`);
  writeFileSync(join(scratch, name), text);
}
writeFileSync(join(scratch, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }));
const dependencies = { "@openuidev/react-lang": "1.0.2", "@openuidev/lang-core": "1.0.2", zod: "4.1.12", react: "19.2.0", "react-dom": "19.2.0", tsx: "4.20.6" };
writeFileSync(join(scratch, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }));
const env = { ...process.env, OPENUI_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: scratch, env, encoding: "utf8", timeout: 120_000 });
  const log = (result.stdout ?? "") + (result.stderr ?? "") + (result.error ? String(result.error) : "");
  process.stdout.write(log);
  return { status: result.status, log };
}
const install = run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"]);
const result = install.status === 0 ? run(process.execPath, ["--import", "tsx", "--test", "report.test.ts", "charts.test.ts", "app-cards.test.ts"]) : install;
writeFileSync(join(out, "smoke.log"), result.log);
const hash = (path) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
const sourceSha256 = Object.fromEntries(Object.values(sources).map((path) => [path, hash(path)]));
writeFileSync(join(out, "smoke-receipt.json"), JSON.stringify({ scope: "isolated stock parser + React SSR, not integrated T3 or browser", status: result.status, node: process.version, dependencies, sourceSha256, scratch }, null, 2));
process.exitCode = result.status ?? 1;
