// Durable-byte accounting for a T3 state DB: bytes per table (pages, incl. indexes) and payload
// bytes per thread across every table keyed by thread, plus the thread event log by event type.
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";

export interface ThreadBytes {
  readonly threadId: string;
  readonly title: string | null;
  readonly archived: boolean;
  readonly bytes: number;
  readonly eventBytes: number;
  readonly projectionBytes: number;
  readonly events: number;
  readonly messages: number;
  readonly turnItems: number;
  readonly runs: number;
  readonly byTable: Record<string, number>;
}

export interface DurableReport {
  readonly fileBytes: { db: number; wal: number; shm: number };
  readonly pageSize: number;
  readonly pageCount: number;
  readonly freelistCount: number;
  readonly tables: Array<{ table: string; rows: number; tableBytes: number; indexBytes: number }>;
  readonly threadEventTypes: Array<{ eventType: string; events: number; bytes: number }>;
  readonly threads: ThreadBytes[];
  readonly threadSummary: {
    count: number;
    total: number;
    p50: number;
    p90: number;
    max: number;
    unattributedBytes: number;
  };
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function fileSize(path: string): number {
  try {
    return NodeFS.statSync(path).size;
  } catch {
    return 0;
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

export function measureDurable(dbPath: string): DurableReport {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const pageSize = Number(
      (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size,
    );
    const pageCount = Number(
      (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count,
    );
    const freelistCount = Number(
      (db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count,
    );
    const objects = db
      .prepare("SELECT name, tbl_name, type FROM sqlite_master WHERE type IN ('table','index')")
      .all() as Array<{ name: string; tbl_name: string; type: string }>;
    const owner = new Map(objects.map((o) => [o.name, o]));
    const pages = db
      .prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name")
      .all() as Array<{ name: string; bytes: number }>;
    const tableBytes = new Map<string, { tableBytes: number; indexBytes: number }>();
    for (const row of pages) {
      const object = owner.get(row.name);
      const table = object?.tbl_name ?? row.name;
      const entry = tableBytes.get(table) ?? { tableBytes: 0, indexBytes: 0 };
      if (object?.type === "table") entry.tableBytes += Number(row.bytes);
      else entry.indexBytes += Number(row.bytes);
      tableBytes.set(table, entry);
    }
    const tableNames = objects.filter((o) => o.type === "table").map((o) => o.name);
    const tables = tableNames
      .map((table) => ({
        table,
        rows: Number(
          (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n,
        ),
        ...(tableBytes.get(table) ?? { tableBytes: 0, indexBytes: 0 }),
      }))
      .sort((a, b) => b.tableBytes + b.indexBytes - (a.tableBytes + a.indexBytes));

    // Per-thread payload bytes: every column's stored byte length, for every table keyed by thread.
    const perThread = new Map<string, Record<string, number>>();
    const add = (threadId: string, table: string, bytes: number) => {
      const entry = perThread.get(threadId) ?? {};
      entry[table] = (entry[table] ?? 0) + bytes;
      perThread.set(threadId, entry);
    };
    type Counts = { events: number; messages: number; turnItems: number; runs: number };
    const counts = new Map<string, Counts>();
    const count = (threadId: string, key: keyof Counts, n: number) => {
      const entry = counts.get(threadId) ?? { events: 0, messages: 0, turnItems: 0, runs: 0 };
      entry[key] += n;
      counts.set(threadId, entry);
    };
    for (const table of tableNames) {
      const columns = (
        db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      let key: string | undefined;
      let where = "";
      if (columns.includes("thread_id")) key = "thread_id";
      else if (table === "orchestration_events") {
        key = "stream_id";
        where = "WHERE aggregate_kind = 'thread'";
      } else if (table === "orchestration_v2_events" && columns.includes("stream_id")) {
        key = "stream_id";
      }
      if (!key) continue;
      const size = columns.map((c) => `COALESCE(LENGTH(CAST(${quote(c)} AS BLOB)),0)`).join("+");
      const rows = db
        .prepare(
          `SELECT ${quote(key)} AS id, SUM(${size}) AS bytes, COUNT(*) AS n FROM ${quote(table)} ${where} GROUP BY ${quote(key)}`,
        )
        .all() as Array<{ id: string | null; bytes: number; n: number }>;
      for (const row of rows) {
        if (row.id === null) continue;
        add(String(row.id), table, Number(row.bytes));
        if (table === "orchestration_events" || table === "orchestration_v2_events")
          count(String(row.id), "events", Number(row.n));
        if (table === "orchestration_v2_projection_messages")
          count(String(row.id), "messages", Number(row.n));
        if (table === "orchestration_v2_projection_turn_items")
          count(String(row.id), "turnItems", Number(row.n));
        if (table === "orchestration_v2_projection_runs")
          count(String(row.id), "runs", Number(row.n));
      }
    }
    const threadRows = db
      .prepare(
        "SELECT thread_id, title, archived_at, deleted_at FROM orchestration_v2_projection_threads",
      )
      .all() as Array<{
      thread_id: string;
      title: string | null;
      archived_at: string | null;
      deleted_at: string | null;
    }>;
    const meta = new Map(threadRows.map((t) => [t.thread_id, t]));
    const threads: ThreadBytes[] = [];
    let unattributedBytes = 0;
    for (const [threadId, byTable] of perThread) {
      const bytes = Object.values(byTable).reduce((a, b) => a + b, 0);
      const row = meta.get(threadId);
      if (!row || row.deleted_at !== null) {
        unattributedBytes += bytes;
        continue;
      }
      const eventBytes =
        (byTable.orchestration_events ?? 0) + (byTable.orchestration_v2_events ?? 0);
      threads.push({
        threadId,
        title: row.title,
        archived: row.archived_at !== null,
        bytes,
        eventBytes,
        projectionBytes: bytes - eventBytes,
        ...(counts.get(threadId) ?? { events: 0, messages: 0, turnItems: 0, runs: 0 }),
        byTable,
      });
    }
    threads.sort((a, b) => b.bytes - a.bytes);
    const sorted = threads.map((t) => t.bytes).sort((a, b) => a - b);

    const threadEventTypes = (
      db
        .prepare(
          `SELECT event_type AS eventType, COUNT(*) AS events, SUM(COALESCE(LENGTH(CAST(payload_json AS BLOB)),0)+COALESCE(LENGTH(CAST(metadata_json AS BLOB)),0)) AS bytes FROM orchestration_events WHERE aggregate_kind = 'thread' GROUP BY event_type ORDER BY bytes DESC`,
        )
        .all() as Array<{ eventType: string; events: number; bytes: number }>
    ).map((r) => ({ eventType: r.eventType, events: Number(r.events), bytes: Number(r.bytes) }));

    return {
      fileBytes: {
        db: fileSize(dbPath),
        wal: fileSize(`${dbPath}-wal`),
        shm: fileSize(`${dbPath}-shm`),
      },
      pageSize,
      pageCount,
      freelistCount,
      tables,
      threadEventTypes,
      threads,
      threadSummary: {
        count: threads.length,
        total: sorted.reduce((a, b) => a + b, 0),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
        max: sorted.at(-1) ?? 0,
        unattributedBytes,
      },
    };
  } finally {
    db.close();
  }
}

/** Picks small (p10 among threads with messages), median and largest threads by durable bytes. */
export function pickThreads(report: DurableReport) {
  const candidates = report.threads.filter((t) => t.messages > 0).sort((a, b) => a.bytes - b.bytes);
  if (candidates.length < 3) throw new Error("need at least three threads with messages");
  const at = (p: number) =>
    candidates[Math.min(candidates.length - 1, Math.floor((p / 100) * (candidates.length - 1)))]!;
  return { small: at(10), median: at(50), largest: candidates.at(-1)! };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: node durable.ts <statev2.sqlite>");
  const report = measureDurable(path);
  console.log(
    JSON.stringify(
      { ...report, threads: report.threads.slice(0, 10).map(({ byTable: _byTable, ...t }) => t) },
      null,
      2,
    ),
  );
}
