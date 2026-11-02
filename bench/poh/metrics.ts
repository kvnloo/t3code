// Metric definitions shared by report.ts (one run) and ab.ts (flag-off vs flag-on arms).
export type Sample = Record<string, any>;

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  // Nearest-rank.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

export interface Metric {
  metric: string;
  unit: "ms" | "bytes" | "s" | "count";
  values: number[];
}

export function metricsFor(samples: Sample[]): Metric[] {
  const metrics: Metric[] = [];
  const add = (metric: string, unit: Metric["unit"], values: number[]) => {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length > 0) metrics.push({ metric, unit, values: finite });
  };
  const of = (kind: string, filter: (s: Sample) => boolean = () => true) =>
    samples.filter((s) => s.kind === kind && filter(s));
  const boots = of("boot", (s) => s.boot > 0);
  add(
    "startup.migrate_boot.ms",
    "ms",
    of("boot", (s) => s.boot === 0).map((s) => s.startupMs),
  );
  add(
    "startup.ready.ms",
    "ms",
    boots.map((s) => s.startupMs),
  );
  add(
    "server.idle_rss.bytes",
    "bytes",
    boots.map((s) => s.idleRss),
  );
  add(
    "server.idle_tree_rss.bytes",
    "bytes",
    boots.map((s) => s.idleTreeRss),
  );
  add(
    "server.boot_cpu.s",
    "s",
    boots.map((s) => s.bootCpuS),
  );
  add(
    "ws.connect.ms",
    "ms",
    of("ws-connect").map((s) => s.ms),
  );
  for (const temp of ["cold", "warm"]) {
    const rows = of("sidebar", (s) => s.temp === temp);
    add(
      `sidebar.${temp}.ms`,
      "ms",
      rows.map((s) => s.ms),
    );
    add(
      `sidebar.${temp}.http_ms`,
      "ms",
      rows.map((s) => s.httpMs),
    );
    add(
      `sidebar.${temp}.ws_ms`,
      "ms",
      rows.map((s) => s.wsMs),
    );
    add(
      `sidebar.${temp}.cpu.s`,
      "s",
      rows.map((s) => s.cpuS),
    );
  }
  add(
    "sidebar.http.bytes",
    "bytes",
    of("sidebar").map((s) => s.httpBytes),
  );
  add(
    "sidebar.ws.bytes",
    "bytes",
    of("sidebar").map((s) => s.wsBytes),
  );
  add(
    "sidebar.threads.count",
    "count",
    of("sidebar").map((s) => s.threads),
  );
  for (const size of ["small", "median", "largest"]) {
    for (const temp of ["cold", "warm"]) {
      const rows = of("thread-open", (s) => s.size === size && s.temp === temp);
      add(
        `thread_open.${size}.${temp}.ms`,
        "ms",
        rows.map((s) => s.ms),
      );
      add(
        `thread_open.${size}.${temp}.http_ms`,
        "ms",
        rows.map((s) => s.httpMs),
      );
      add(
        `thread_open.${size}.${temp}.ws_ms`,
        "ms",
        rows.map((s) => s.wsMs),
      );
      add(
        `thread_open.${size}.${temp}.cpu.s`,
        "s",
        rows.map((s) => s.cpuS),
      );
    }
    const rows = of("thread-open", (s) => s.size === size);
    add(
      `thread_open.${size}.http.bytes`,
      "bytes",
      rows.map((s) => s.httpBytes),
    );
    add(
      `thread_open.${size}.ws.bytes`,
      "bytes",
      rows.map((s) => s.wsBytes),
    );
    const socket = of("thread-open-socket", (s) => s.size === size);
    add(
      `thread_open_socket_only.${size}.ms`,
      "ms",
      socket.map((s) => s.ms),
    );
    add(
      `thread_open_socket_only.${size}.ws.bytes`,
      "bytes",
      socket.map((s) => s.wsBytes),
    );
    add(
      `thread_open_socket_only.${size}.cpu.s`,
      "s",
      socket.map((s) => s.cpuS),
    );
    const full = of("thread-full-http", (s) => s.size === size);
    add(
      `thread_full_http.${size}.ms`,
      "ms",
      full.map((s) => s.ms),
    );
    add(
      `thread_full_http.${size}.bytes`,
      "bytes",
      full.map((s) => s.httpBytes),
    );
    add(
      `thread_full_http.${size}.client_parse_ms`,
      "ms",
      full.map((s) => s.parseMs),
    );
  }
  const idle = of("reconnect-idle");
  add(
    "reconnect.idle.ms",
    "ms",
    idle.map((s) => s.ms),
  );
  add(
    "reconnect.idle.ws.bytes",
    "bytes",
    idle.map((s) => s.wsBytes),
  );
  add(
    "reconnect.idle.http.bytes",
    "bytes",
    idle.map((s) => s.httpBytes),
  );
  add(
    "reconnect.idle.cpu.s",
    "s",
    idle.map((s) => s.cpuS),
  );
  const missed = of("reconnect-missed-turn");
  add(
    "reconnect.missed_turn.ms",
    "ms",
    missed.map((s) => s.ms),
  );
  add(
    "reconnect.missed_turn.ws.bytes",
    "bytes",
    missed.map((s) => s.wsBytes),
  );
  add(
    "reconnect.missed_turn.thread_ws.bytes",
    "bytes",
    missed.map((s) => s.threadWsBytes),
  );
  add(
    "reconnect.missed_turn.http.bytes",
    "bytes",
    missed.map((s) => s.httpBytes),
  );
  add(
    "reconnect.missed_turn.replayed_events.count",
    "count",
    missed.map((s) => s.threadKinds?.event ?? 0),
  );
  const turns = of("turn");
  add(
    "turn.sim.ms",
    "ms",
    turns.map((s) => s.ms),
  );
  add(
    "turn.sim.db_used_delta.bytes",
    "bytes",
    turns.map((s) => s.dbUsedDelta),
  );
  add(
    "turn.sim.thread_payload_delta.bytes",
    "bytes",
    turns.map((s) => s.threadBytesDelta),
  );
  add(
    "turn.sim.cpu.s",
    "s",
    turns.filter((s) => s.cpuS !== undefined).map((s) => s.cpuS),
  );
  const peaks = new Map<number, number>();
  for (const s of samples) {
    if (typeof s.peakRss === "number")
      peaks.set(s.boot, Math.max(peaks.get(s.boot) ?? 0, s.peakRss));
  }
  add(
    "server.peak_rss_per_boot.bytes",
    "bytes",
    [...peaks.entries()].filter(([b]) => b > 0).map(([, v]) => v),
  );
  add(
    "server.end_rss_per_boot.bytes",
    "bytes",
    of("boot-end").map((s) => s.rss),
  );
  add(
    "server.tree_cpu_per_boot.s",
    "s",
    of("boot-end").map((s) => s.treeCpuS),
  );
  return metrics;
}

export const fmt = (unit: Metric["unit"], v: number) => {
  if (!Number.isFinite(v)) return "n/a";
  if (unit === "bytes") {
    if (Math.abs(v) >= 2 ** 20) return `${(v / 2 ** 20).toFixed(1)} MiB`;
    if (Math.abs(v) >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
    return `${Math.round(v)} B`;
  }
  if (unit === "ms") return v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
  if (unit === "s") return `${v.toFixed(2)} s`;
  return String(Math.round(v));
};
