#!/usr/bin/env node
// Dogfood ACP proxy: `node acp-with-connectors.mjs <agent command...>`. Adds the demo connectors
// to every session so a sandbox provider gets Gmail/Uber/Maps/GitHub without touching agent config.
// OPENUI_CATALOG_FILE, when set, is appended to each prompt in place of catalog instructions
// T3 does not inject yet.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("usage: acp-with-connectors.mjs <agent command...>\n");
  process.exit(2);
}

const connectorPath = NodeURL.fileURLToPath(new URL("./demo-connectors.mjs", import.meta.url));
const servers = ["gmail", "uber", "google-maps", "github"].map((name) => ({
  name,
  command: process.execPath,
  args: [connectorPath, name],
  env: [],
}));
const catalog = process.env.OPENUI_CATALOG_FILE
  ? `The openui-v2 catalog for this reply is complete below; do not look for it elsewhere.\n\n${NodeFS.readFileSync(process.env.OPENUI_CATALOG_FILE, "utf8")}`
  : null;
const SESSION_METHODS = new Set(["session/new", "session/load", "session/resume", "session/fork"]);

const child = NodeChildProcess.spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));

NodeReadline.createInterface({ input: process.stdin })
  .on("line", (line) => {
    let out = line;
    try {
      const message = JSON.parse(line);
      if (SESSION_METHODS.has(message.method) && message.params) {
        const existing = (message.params.mcpServers ?? []).filter(
          (server) => !servers.some((demo) => demo.name === server.name),
        );
        message.params.mcpServers = [...existing, ...servers];
        out = JSON.stringify(message);
      } else if (
        catalog &&
        message.method === "session/prompt" &&
        Array.isArray(message.params?.prompt)
      ) {
        message.params.prompt = [...message.params.prompt, { type: "text", text: catalog }];
        out = JSON.stringify(message);
      }
    } catch {}
    child.stdin.write(`${out}\n`);
  })
  .on("close", () => child.stdin.end());
