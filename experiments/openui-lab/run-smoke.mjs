import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(process.argv[2] ?? join(root, ".t3/openui-smoke"));
const scratch = mkdtempSync(join(tmpdir(), "t3-openui-smoke-"));
mkdirSync(out, { recursive: true });
const modulePath = join(root, "apps/web/src/components/chat/OpenUiReport.tsx");
const testPath = join(root, "experiments/openui-lab/report.test.ts");
copyFileSync(modulePath, join(scratch, "OpenUiReport.tsx"));
writeFileSync(join(scratch, "report.test.ts"), readFileSync(testPath, "utf8").replace("../../apps/web/src/components/chat/OpenUiReport", "./OpenUiReport"));
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
const result = install.status === 0 ? run(process.execPath, ["--import", "tsx", "--test", "report.test.ts"]) : install;
writeFileSync(join(out, "smoke.log"), result.log);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(join(out, "smoke-receipt.json"), JSON.stringify({ scope: "isolated stock parser + React SSR, not integrated T3 or browser", status: result.status, node: process.version, dependencies, moduleSha256: hash(modulePath), testsSha256: hash(testPath), scratch }, null, 2));
process.exitCode = result.status ?? 1;
