// Starts this worktree's server from source on its own port against a bench home, tracks its PID
// tree, samples RSS/CPU from /proc, and stops exactly the PIDs it started.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

export const repoRoot = NodePath.resolve(import.meta.dirname, "../..");

export async function freePort(): Promise<number> {
  const server = NodeNet.createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

// Provider CLIs (claude, codex, hermes, ...) stay off PATH so the bench server can never resume a
// real provider session against the owner's projects. Only the devReplay ACP agent (absolute path,
// spawned with this node) can run turns.
const PROVIDER_BINARIES = new Set([
  "claude",
  "codex",
  "hermes",
  "opencode",
  "cursor-agent",
  "agent",
  "grok",
  "gemini",
  "pi",
  "amp",
  "copilot",
  "droid",
  "goose",
  "qwen",
  "kimi",
  "devin",
  "t3",
]);

export function sandboxPath(benchHome: string): string {
  const bin = NodePath.join(benchHome, "bin");
  if (!NodeFS.existsSync(bin)) {
    NodeFS.mkdirSync(bin, { recursive: true });
    for (const name of NodeFS.readdirSync("/usr/bin")) {
      if (PROVIDER_BINARIES.has(name)) continue;
      try {
        NodeFS.symlinkSync(NodePath.join("/usr/bin", name), NodePath.join(bin, name));
      } catch {}
    }
    for (const name of ["node", "npm", "npx"]) {
      const target = NodePath.join(NodePath.dirname(process.execPath), name);
      if (!NodeFS.existsSync(target)) continue;
      NodeFS.rmSync(NodePath.join(bin, name), { force: true });
      NodeFS.symlinkSync(target, NodePath.join(bin, name));
    }
  }
  return bin;
}

export interface RunningServer {
  readonly pid: number;
  readonly port: number;
  readonly origin: string;
  readonly bootstrapToken: string;
  readonly startupMs: number;
  readonly logPath: string;
  stop(): Promise<void>;
}

export async function startServer(options: {
  readonly t3Home: string;
  readonly benchHome: string;
  readonly logPath: string;
  readonly timeoutMs?: number;
}): Promise<RunningServer> {
  const port = await freePort();
  const devPort = await freePort();
  const bootstrapToken = NodeCrypto.randomUUID();
  const started = performance.now();
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? "",
    USER: process.env.USER ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    PATH: sandboxPath(options.benchHome),
    T3CODE_TELEMETRY_ENABLED: "false",
    T3CODE_OTEL_SDK_DISABLED: "true",
    T3CODE_NO_BROWSER: "1",
  };
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      "apps/server/src/bin.ts",
      "start",
      "--bootstrap-fd",
      "3",
      // Explicit, so state lives in <home>/userdata even though --dev-url is set.
      "--base-dir",
      options.t3Home,
      // A dev URL makes this a dev server: it seeds the free devReplay ACP agent used for turns.
      "--dev-url",
      `http://127.0.0.1:${devPort}`,
      "--log-level",
      "info",
    ],
    { cwd: repoRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe", "pipe"] },
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error("server did not spawn");
  const bootstrapPipe = child.stdio[3] as NodeJS.WritableStream;
  bootstrapPipe.end(
    JSON.stringify({
      mode: "desktop",
      noBrowser: true,
      port,
      t3Home: options.t3Home,
      host: "127.0.0.1",
      desktopBootstrapToken: bootstrapToken,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    }),
  );
  const log = NodeFS.openSync(options.logPath, "a");
  let tail = "";
  const ready = Promise.withResolvers<void>();
  for (const pipe of [child.stdout, child.stderr]) {
    pipe?.on("data", (data: Buffer) => {
      const text = data.toString().replaceAll(bootstrapToken, "[REDACTED]");
      NodeFS.writeSync(log, text);
      tail = (tail + text).slice(-16384);
    });
  }
  // Ready = the HTTP API answers an authenticated-free descriptor read.
  const poll = { active: true };
  void (async () => {
    while (poll.active) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`);
        if (response.ok) {
          await response.arrayBuffer();
          ready.resolve();
          return;
        }
      } catch {}
      await new Promise((done) => setTimeout(done, 50));
    }
  })();
  let exited = false;
  const exit = new Promise<void>((done) =>
    child.once("exit", (code) => {
      exited = true;
      ready.reject(new Error(`server exited ${code} before ready; see ${options.logPath}`));
      done();
    }),
  );
  const deadline = setTimeout(
    () => ready.reject(new Error("server startup timed out")),
    options.timeoutMs ?? 600_000,
  );
  try {
    await ready.promise;
  } catch (error) {
    if (!exited) process.kill(-pid, "SIGKILL");
    throw error;
  } finally {
    poll.active = false;
    clearTimeout(deadline);
  }
  const startupMs = performance.now() - started;
  return {
    pid,
    port,
    origin: `http://127.0.0.1:${port}`,
    bootstrapToken,
    startupMs,
    logPath: options.logPath,
    async stop() {
      if (exited) return;
      // The server runs in its own process group (detached), so this signals only what we spawned.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}
      const timer = setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }, 15_000);
      await exit;
      clearTimeout(timer);
      NodeFS.closeSync(log);
    },
  };
}

const CLK_TCK = 100;
const PAGE_SIZE = 4096;

function descendants(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const entry of NodeFS.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = NodeFS.readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const list = children.get(ppid) ?? [];
      list.push(Number(entry));
      children.set(ppid, list);
    } catch {}
  }
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...(children.get(out[i]!) ?? []));
  return out;
}

function readProc(pid: number): { rss: number; cpuTicks: number } | undefined {
  try {
    const stat = NodeFS.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const statm = NodeFS.readFileSync(`/proc/${pid}/statm`, "utf8").split(" ");
    return {
      cpuTicks: Number(fields[11]) + Number(fields[12]),
      rss: Number(statm[1]) * PAGE_SIZE,
    };
  } catch {
    return undefined;
  }
}

export interface ProcSample {
  readonly at: number;
  readonly serverRss: number;
  readonly treeRss: number;
  readonly serverCpuS: number;
  readonly treeCpuS: number;
  readonly processes: number;
}

export function sampleTree(root: number): ProcSample {
  const pids = descendants(root);
  let treeRss = 0;
  let treeTicks = 0;
  let serverRss = 0;
  let serverTicks = 0;
  for (const pid of pids) {
    const value = readProc(pid);
    if (!value) continue;
    treeRss += value.rss;
    treeTicks += value.cpuTicks;
    if (pid === root) {
      serverRss = value.rss;
      serverTicks = value.cpuTicks;
    }
  }
  return {
    at: performance.now(),
    serverRss,
    treeRss,
    serverCpuS: serverTicks / CLK_TCK,
    treeCpuS: treeTicks / CLK_TCK,
    processes: pids.length,
  };
}

/** Samples the server tree every `intervalMs` while `work` runs; returns peak RSS and CPU used. */
export async function withProcSampling<T>(
  pid: number,
  work: () => Promise<T>,
  intervalMs = 50,
): Promise<{
  result: T;
  peakServerRss: number;
  peakTreeRss: number;
  cpuS: number;
  treeCpuS: number;
  wallMs: number;
}> {
  const before = sampleTree(pid);
  let peakServerRss = before.serverRss;
  let peakTreeRss = before.treeRss;
  const timer = setInterval(() => {
    const sample = sampleTree(pid);
    peakServerRss = Math.max(peakServerRss, sample.serverRss);
    peakTreeRss = Math.max(peakTreeRss, sample.treeRss);
  }, intervalMs);
  try {
    const result = await work();
    const after = sampleTree(pid);
    peakServerRss = Math.max(peakServerRss, after.serverRss);
    peakTreeRss = Math.max(peakTreeRss, after.treeRss);
    return {
      result,
      peakServerRss,
      peakTreeRss,
      cpuS: after.serverCpuS - before.serverCpuS,
      treeCpuS: after.treeCpuS - before.treeCpuS,
      wallMs: after.at - before.at,
    };
  } finally {
    clearInterval(timer);
  }
}
