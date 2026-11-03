// PoH P2/02: live turns and a writer probe (`thread.visit`) while a compaction (+ fold) pass runs in
// a measured boot, one boot per fresh unfolded seed copy. On arm: also pass
// T3CODE_EXPERIMENTAL_SNAPSHOT_FOLD_SETTLE_MS=0; the pass starts 1 minute after boot.
// Usage: node bench/poh/fold-pass.ts --seed <seed> --out <dir> [--server-env K=V] [--window-s 240]
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { prepareHome } from "./prepare-home.ts";
import { ORCHESTRATION_PROTOCOL_HEADER, ORCHESTRATION_PROTOCOL_VERSION } from "./protocol.ts";
import { repoRoot, sampleTree, startServer } from "./server.ts";
import { WsRpc } from "./wsrpc.ts";

const { values: args } = NodeUtil.parseArgs({
  options: {
    seed: { type: "string" },
    out: { type: "string" },
    "server-env": { type: "string", multiple: true, default: [] },
    "window-s": { type: "string", default: "240" },
    "probe-ms": { type: "string", default: "250" },
  },
});
if (args.seed === undefined || args.out === undefined) throw new Error("--seed and --out required");
const serverEnv = Object.fromEntries(
  (args["server-env"] ?? []).map((entry) => {
    const at = entry.indexOf("=");
    return [entry.slice(0, at), entry.slice(at + 1)];
  }),
);
const WINDOW_MS = Number(args["window-s"]) * 1000;
const PROBE_MS = Number(args["probe-ms"]);
const sha = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const dirty = NodeChildProcess.execFileSync(
  "git",
  ["status", "--porcelain", "--", ".", ":!bench"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
).trim();
const out = NodePath.resolve(args.out);
NodeFS.mkdirSync(out, { recursive: true });
const benchHome = NodePath.join(repoRoot, ".t3/bench");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const t3Home = NodePath.join(benchHome, `home-pass-${stamp}`);
const samplesPath = NodePath.join(out, "samples.ndjson");
const record = (sample: Record<string, unknown>) =>
  NodeFS.appendFileSync(samplesPath, JSON.stringify({ sha, ...sample }) + "\n");
const log = (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  NodeFS.appendFileSync(NodePath.join(out, "bench.log"), line + "\n");
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const TERMINAL_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);

log(`sha ${sha}${dirty ? " (dirty outside bench/)" : ""}; env ${JSON.stringify(serverEnv)}`);
const prepared = prepareHome({ seed: args.seed, t3Home });
const spawnedAt = performance.now();
const rel = () => performance.now() - spawnedAt;
const logPath = NodePath.join(out, "server.log");
const server = await startServer({ t3Home, benchHome, env: serverEnv, logPath });
log(`pid ${server.pid} port ${server.port} ready ${Math.round(server.startupMs)}ms`);
const pass: Record<string, number> = {};
const state = { stopped: false };
try {
  const token = await fetch(`${server.origin}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: server.bootstrapToken,
      subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    }),
  });
  const { access_token } = (await token.json()) as { access_token: string };
  const headers = {
    Authorization: `Bearer ${access_token}`,
    [ORCHESTRATION_PROTOCOL_HEADER]: String(ORCHESTRATION_PROTOCOL_VERSION),
  };
  const connect = async () => {
    const response = await fetch(`${server.origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers,
    });
    const { ticket } = (await response.json()) as { ticket: string };
    return WsRpc.connect(server.origin, ticket);
  };
  const waitForRuns = async (rpc: WsRpc, threadId: string, minRuns: number) => {
    const runs = new Map<string, string>();
    const { done } = rpc.stream(
      "orchestration.subscribeThread",
      { threadId, requestCompletionMarker: true },
      (values) => {
        for (const value of values as Array<Record<string, any>>) {
          if (value.kind === "snapshot") {
            for (const run of value.projection.runs ?? []) runs.set(run.id, run.status);
          } else if (value.kind === "event" && value.event?.type === "run.updated") {
            runs.set(value.event.payload.id, value.event.payload.status);
          }
        }
        return (
          runs.size >= minRuns && [...runs.values()].every((status) => TERMINAL_RUN.has(status))
        );
      },
    );
    await done;
    return runs;
  };

  // Scratch project and devReplay thread, as bench.ts boot 0 does.
  const projectRoot = NodePath.join(t3Home, "bench-project");
  NodeFS.mkdirSync(projectRoot, { recursive: true });
  NodeChildProcess.execFileSync("git", ["init", "-q", projectRoot]);
  NodeChildProcess.execFileSync("git", [
    "-C",
    projectRoot,
    "-c",
    "user.name=Bench",
    "-c",
    "user.email=bench@localhost",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  ]);
  const projectId = NodeCrypto.randomUUID();
  await fetch(`${server.origin}/api/projects/mutate`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "project.create",
      commandId: NodeCrypto.randomUUID(),
      projectId,
      title: "PoH fold pass bench",
      workspaceRoot: projectRoot,
    }),
  });
  const driver = await connect();
  const threadId = NodeCrypto.randomUUID();
  await driver.call("orchestration.launchThread", {
    commandId: NodeCrypto.randomUUID(),
    threadId,
    projectId,
    title: "PoH fold pass turns",
    modelSelection: { instanceId: "devReplay", model: "showcase" },
    runtimeMode: "full-access",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    initialMessage: { text: "Pass turn 0", attachments: [] },
  });
  await waitForRuns(driver, threadId, 1);
  let runCount = 1;
  log(`launch settled at ${Math.round(rel())}ms`);

  // Pass bounds as the bench observes them in the server log.
  const watchLog = (async () => {
    while (!state.stopped) {
      const text = NodeFS.existsSync(logPath) ? NodeFS.readFileSync(logPath, "utf8") : "";
      if (pass.foldStart === undefined && text.includes("Folding superseded orchestration")) {
        pass.foldStart = rel();
        log(`fold start at ${Math.round(pass.foldStart)}ms`);
      }
      if (pass.foldEnd === undefined && text.includes("Folded superseded orchestration")) {
        pass.foldEnd = rel();
        log(`fold end at ${Math.round(pass.foldEnd)}ms`);
      }
      if (pass.compacted === undefined && text.includes("Compacted orchestration history")) {
        pass.compacted = rel();
      }
      await sleep(100);
    }
  })();

  // WebSocket sessions expire after 5 minutes (SessionStore), so the probe reconnects every 30 s
  // and each turn opens its own socket, as a long-lived client re-authenticates.
  const probe = (async () => {
    let i = 0;
    while (!state.stopped) {
      const rpc = await connect();
      const opened = performance.now();
      while (!state.stopped && performance.now() - opened < 30_000) {
        const started = performance.now();
        const at = rel();
        await rpc.call("orchestration.dispatchCommand", {
          type: "thread.visit",
          commandId: NodeCrypto.randomUUID(),
          threadId,
          visitedAt: new Date().toISOString(),
        });
        record({ kind: "probe", i: i++, at, ms: performance.now() - started });
        await sleep(Math.max(0, PROBE_MS - (performance.now() - started)));
      }
      await rpc.close();
    }
  })();

  const cpu = (async () => {
    let previous = sampleTree(server.pid);
    while (!state.stopped) {
      await sleep(1000);
      const next = sampleTree(server.pid);
      record({
        kind: "cpu",
        at: rel(),
        busy: next.treeCpuS - previous.treeCpuS,
        rss: next.serverRss,
      });
      previous = next;
    }
  })();

  await driver.close();
  let turn = 0;
  while (rel() < WINDOW_MS) {
    const turnSocket = await connect();
    const at = rel();
    const started = performance.now();
    await turnSocket.call("orchestration.dispatchCommand", {
      type: "message.dispatch",
      commandId: NodeCrypto.randomUUID(),
      threadId,
      messageId: NodeCrypto.randomUUID(),
      text: `Pass turn ${++turn}`,
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      dispatchMode: { type: "start_immediately" },
    });
    const runs = await waitForRuns(turnSocket, threadId, ++runCount);
    await turnSocket.close();
    record({
      kind: "turn",
      turn,
      at,
      end: rel(),
      ms: performance.now() - started,
      status: [...runs.values()].at(-1),
    });
  }
  state.stopped = true;
  await Promise.all([watchLog, probe, cpu]);
  const folded = NodeFS.readFileSync(logPath, "utf8").match(
    /Folded superseded orchestration snapshots[\s\S]*?passMillis: ([\d.]+)/,
  );
  const fields = (name: string) =>
    Number(
      NodeFS.readFileSync(logPath, "utf8").match(new RegExp(`${name}: ([\\d.]+)`))?.[1] ?? NaN,
    );
  NodeFS.writeFileSync(
    NodePath.join(out, "run.json"),
    JSON.stringify(
      {
        sha,
        dirty,
        seed: args.seed,
        serverEnv,
        disabledScheduledTasks: prepared.disabledScheduledTasks,
        startupMs: server.startupMs,
        windowMs: WINDOW_MS,
        probeMs: PROBE_MS,
        pass,
        foldLog:
          folded === null
            ? null
            : {
                passMillis: Number(folded[1]),
                foldedEntityCount: fields("foldedEntityCount"),
                deletedEventCount: fields("deletedEventCount"),
                transactionCount: fields("transactionCount"),
                longestTransactionMillis: fields("longestTransactionMillis"),
              },
      },
      null,
      2,
    ),
  );
  log(`done: ${out}`);
} finally {
  state.stopped = true;
  await server.stop();
  NodeFS.rmSync(t3Home, { recursive: true, force: true });
}
