import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The shared gallery logic is dependency-free. Run the same test assertions with node:test.
const out = process.env.TMPDIR + "/openui-gallery-tests";
mkdirSync(out, { recursive: true });
for (const name of ["openUiGallery.ts", "openUiCharts.ts", "openUiAppCards.ts", "appConnectors.ts"]) {
  copyFileSync(join("packages/client-runtime/src", name), join(out, name));
}
const test = readFileSync("packages/client-runtime/src/openUiGallery.test.ts", "utf8").replace(
  'import { it as test } from "vite-plus/test";',
  'import { it as test } from "node:test";',
);
writeFileSync(join(out, "gallery.test.ts"), test);
const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", join(out, "gallery.test.ts")], { stdio: "inherit" });
process.exit(result.status ?? 1);
