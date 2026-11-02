// Reads wire constants from this checkout's contracts source, so the harness follows the SHA under
// test without importing Effect.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const source = NodeFS.readFileSync(
  NodePath.resolve(import.meta.dirname, "../../packages/contracts/src/environment.ts"),
  "utf8",
);

function constant(name: string): string {
  const match = new RegExp(`export const ${name} = ([^;]+);`).exec(source);
  if (!match) throw new Error(`contracts constant ${name} not found`);
  return match[1]!.trim().replace(/^"|"$/g, "");
}

export const ORCHESTRATION_PROTOCOL_VERSION = Number(constant("ORCHESTRATION_PROTOCOL_VERSION"));
export const ORCHESTRATION_PROTOCOL_HEADER = constant("ORCHESTRATION_PROTOCOL_HEADER");
