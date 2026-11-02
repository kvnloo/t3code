// PoH P2/01: classifies every durable byte of a T3 state DB and projects the durable size under
// two eviction policies, on disposable copies only. Subcommands: prepare (migrate + doctor copy),
// analyze (classify + simulate), report (markdown + ledger). Classes and policies: README.md.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import { measureDurable, percentile } from "./durable.ts";
import { prepareHome } from "./prepare-home.ts";
import { repoRoot, startServer } from "./server.ts";

export const CLASSES = [
  "message-text",
  "reasoning-text",
  "tool-input",
  "tool-output",
  "image",
  "duplicate",
  "t3-owned",
  "metadata",
] as const;
export type Cls = (typeof CLASSES)[number];
type Bytes = Partial<Record<Cls, number>>;

// §1.3 of SURFACE-MAP.md: kinds T3 authors itself. Everything else is transcript.
export const T3_OWNED_ITEM_TYPES = new Set([
  "approval_request",
  "user_input_request",
  "secret_request",
  "link_request",
  "checkpoint",
  "run_interrupt_request",
  "run_interrupt_result",
  "subagent",
  "handoff",
  "fork",
  "thread_created",
  "notification",
  "system_notice",
  "error",
]);

// Per transcript item type: which top-level keys carry which class. Unlisted keys are metadata
// (ids, refs, timestamps, status, titles); `unlisted` collects large unlisted keys for review.
const TEXT_KEYS: Record<string, Record<string, Cls>> = {
  assistant_message: { text: "message-text" },
  user_message: { text: "message-text", attachments: "message-text" },
  reasoning: { text: "reasoning-text", summary: "reasoning-text", content: "reasoning-text" },
  todo_list: { items: "message-text", todos: "message-text", text: "message-text" },
  proposed_plan: { text: "message-text", markdown: "message-text", plan: "message-text" },
  compaction: { summary: "message-text", text: "message-text" },
  dynamic_tool: { output: "tool-output", result: "tool-output", input: "tool-input" },
  command_execution: {
    output: "tool-output",
    aggregatedOutput: "tool-output",
    input: "tool-input",
    command: "tool-input",
  },
  file_change: {
    diffStr: "tool-output",
    diff: "tool-output",
    changes: "tool-output",
    patch: "tool-output",
  },
  file_search: { results: "tool-output", pattern: "tool-input", query: "tool-input" },
  web_search: {
    results: "tool-output",
    output: "tool-output",
    content: "tool-output",
    query: "tool-input",
    action: "tool-input",
  },
};
const MESSAGE_KEYS: Record<string, Cls> = { text: "message-text", attachments: "message-text" };
const HANDOFF_KEYS: Record<string, Cls> = { history: "message-text", summaryText: "message-text" };

const BASE64 = /^(?:data:[a-z]+\/[a-z0-9.+-]+;base64,)?[A-Za-z0-9+/\r\n]{256,}={0,2}$/;
const utf8 = (s: string) => Buffer.byteLength(s);
const jsonBytes = (v: unknown) => utf8(JSON.stringify(v));
const sha256 = (s: string) => NodeCrypto.createHash("sha256").update(s).digest("hex");

function addTo(target: Bytes, cls: Cls, n: number) {
  if (n !== 0) target[cls] = (target[cls] ?? 0) + n;
}

/** Bytes of inline base64 strings inside a value (counted as JSON string bytes). */
function imageBytes(value: unknown): number {
  if (typeof value === "string") {
    return value.length >= 256 && BASE64.test(value) ? jsonBytes(value) : 0;
  }
  if (value === null || typeof value !== "object") return 0;
  let n = 0;
  for (const v of Array.isArray(value) ? value : Object.values(value)) n += imageBytes(v);
  return n;
}

const unlisted = new Map<string, number>();

/** Splits one JSON object payload (stored as `raw`) into classes by top-level key. */
export function classifyObject(
  raw: string,
  payload: Record<string, unknown>,
  keys: Record<string, Cls>,
  label: string,
): Bytes {
  const out: Bytes = {};
  let attributed = 0;
  for (const [key, value] of Object.entries(payload)) {
    const cls = keys[key];
    if (!cls) {
      const size = jsonBytes(value);
      if (size > 4096)
        unlisted.set(`${label}.${key}`, (unlisted.get(`${label}.${key}`) ?? 0) + size);
      continue;
    }
    const size = jsonBytes(key) + 1 + jsonBytes(value) + 1;
    const image = imageBytes(value);
    addTo(out, "image", image);
    addTo(out, cls, size - image);
    attributed += size;
  }
  // Ids, refs, timestamps, braces and separators. Stored JSON matches JSON.stringify here.
  addTo(out, "metadata", Math.max(0, utf8(raw) - attributed));
  return out;
}

export function classifyItem(raw: string): Bytes {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const type = String(payload.type ?? "");
  if (T3_OWNED_ITEM_TYPES.has(type)) return { "t3-owned": utf8(raw) };
  return classifyObject(raw, payload, TEXT_KEYS[type] ?? {}, `item:${type}`);
}

// Event types whose payload is a full upsert snapshot keyed by `$.id`: a later row supersedes an
// earlier one for the same (stream, type, id). Subagent snapshots and commanded turn items are
// excluded for the same reasons `t3 doctor` keeps them (ProjectionMaintenance.compactEventStore).
const SNAPSHOT_EVENT_TYPES = new Set([
  "message.updated",
  "node.updated",
  "turn-item.updated",
  "plan.updated",
  "provider-thread.updated",
  "provider-session.updated",
  "provider-turn.updated",
  "run.updated",
  "run-attempt.updated",
  "context-handoff.updated",
  "context-transfer.updated",
  "runtime-request.updated",
  "checkpoint-scope.updated",
]);

interface EventRow {
  readonly sequence: number;
  readonly stream_id: string;
  readonly event_type: string;
  readonly aggregate_kind: string;
  readonly command_id: string | null;
  readonly payload_json: string;
  readonly other: number; // every other column's stored bytes
}

function eventKey(row: EventRow, payload: Record<string, unknown>): string | null {
  if (row.aggregate_kind !== "thread" || !SNAPSHOT_EVENT_TYPES.has(row.event_type)) return null;
  if (
    row.event_type === "turn-item.updated" &&
    (row.command_id !== null || payload.type === "subagent")
  )
    return null;
  const id = payload.id;
  return typeof id === "string" ? `${row.stream_id}\u0000${row.event_type}\u0000${id}` : null;
}

export function classifyEventPayload(eventType: string, raw: string): Bytes {
  switch (eventType) {
    case "turn-item.updated":
      return classifyItem(raw);
    case "message.updated":
      return classifyObject(raw, JSON.parse(raw), MESSAGE_KEYS, "event:message");
    case "plan.updated": {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const keys = Object.fromEntries(
        Object.keys(payload)
          .filter((k) => !/(^id$|Id$|At$|^status$|^ordinal$)/.test(k))
          .map((k) => [k, "message-text" as Cls]),
      );
      return classifyObject(raw, payload, keys, "event:plan");
    }
    case "node.updated":
      return { metadata: utf8(raw) };
    case "context-handoff.updated":
      return classifyObject(raw, JSON.parse(raw), HANDOFF_KEYS, "event:handoff");
    default:
      return { "t3-owned": utf8(raw) };
  }
}

// Tables: which column holds a classifiable payload, and how.
type TableRule =
  | { kind: "item" }
  | { kind: "keys"; keys: Record<string, Cls> }
  | { kind: "all"; cls: Cls };
const TABLE_RULES: Record<string, TableRule> = {
  orchestration_v2_projection_turn_items: { kind: "item" },
  orchestration_v2_projection_messages: { kind: "keys", keys: MESSAGE_KEYS },
  orchestration_v2_projection_plans: { kind: "all", cls: "message-text" },
  orchestration_v2_projection_context_handoffs: { kind: "keys", keys: HANDOFF_KEYS },
  orchestration_v2_projection_nodes: { kind: "all", cls: "metadata" },
  orchestration_v2_turn_item_positions: { kind: "all", cls: "metadata" },
  projection_thread_messages: { kind: "all", cls: "message-text" },
  orchestration_v2_events: { kind: "all", cls: "duplicate" },
  mcp_app_model_context: { kind: "all", cls: "message-text" },
  auth_sessions: { kind: "all", cls: "t3-owned" },
  auth_pairing_links: { kind: "all", cls: "t3-owned" },
  effect_sql_migrations: { kind: "all", cls: "metadata" },
  sqlite_stat1: { kind: "all", cls: "metadata" },
  sqlite_sequence: { kind: "all", cls: "metadata" },
};
const isFtsShadow = (name: string) =>
  /message_search_(data|idx|docsize|config|content)$/.test(name);

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

interface TableAccount {
  table: string;
  rows: number;
  pageBytes: number; // table b-tree pages (dbstat)
  indexBytes: number; // its indexes (dbstat)
  unusedBytes: number; // slack inside the table's own pages
  logical: Bytes; // column bytes by class
}

export interface Account {
  readonly db: string;
  readonly fileBytes: number;
  readonly pageSize: number;
  readonly freeBytes: number;
  readonly tables: TableAccount[];
  readonly totals: Record<string, number>; // class -> bytes, incl. "index", "slack", "free", "fts"
  readonly eventTypes: Array<{ eventType: string; events: number; bytes: number; byClass: Bytes }>;
  readonly itemTypes: Array<{ itemType: string; rows: number; bytes: number; byClass: Bytes }>;
  readonly duplicateSequences: number[];
  readonly duplicateBytesByType: Record<string, number>;
  readonly bytesByProvider: Record<string, Bytes>; // payload-bearing bytes by provider and class
  readonly perThread: Record<string, Bytes>;
}

/** provider key for a providerThreadId / thread, e.g. `acpRegistry/hermes`, `codex`, `claude-import`. */
function providerResolver(db: NodeSqlite.DatabaseSync) {
  const byProviderThread = new Map<string, string>();
  const byThread = new Map<string, Map<string, number>>();
  for (const row of db
    .prepare("SELECT payload_json FROM orchestration_v2_projection_provider_threads")
    .iterate() as Iterable<{ payload_json: string }>) {
    const p = JSON.parse(row.payload_json) as {
      id: string;
      driver: string;
      providerInstanceId?: string;
      appThreadId?: string;
    };
    const key =
      p.driver === "acpRegistry" ? `acpRegistry/${p.providerInstanceId ?? "?"}` : String(p.driver);
    byProviderThread.set(p.id, key);
    if (p.appThreadId) {
      const m = byThread.get(p.appThreadId) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      byThread.set(p.appThreadId, m);
    }
  }
  return (threadId: string, providerThreadId: unknown): string => {
    if (typeof providerThreadId === "string" && byProviderThread.has(providerThreadId))
      return byProviderThread.get(providerThreadId)!;
    if (typeof providerThreadId === "string") {
      const m = /^provider-thread:provider:([^:]+):/.exec(providerThreadId);
      if (m) return m[1] === "acpRegistry" ? "acpRegistry/?" : m[1]!;
    }
    if (threadId.startsWith("import:claude-history")) return "claude-import";
    if (threadId.startsWith("import:codex")) return "codex-import";
    const m = byThread.get(threadId);
    if (m) return [...m].sort((a, b) => b[1] - a[1])[0]![0];
    return "none";
  };
}

export function account(dbPath: string): Account {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const pageSize = Number(
      (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size,
    );
    const freeBytes =
      Number(
        (db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count,
      ) * pageSize;
    const objects = db
      .prepare("SELECT name, tbl_name, type FROM sqlite_master WHERE type IN ('table','index')")
      .all() as Array<{ name: string; tbl_name: string; type: string }>;
    const owner = new Map(objects.map((o) => [o.name, o]));
    const stat = db
      .prepare("SELECT name, SUM(pgsize) AS bytes, SUM(unused) AS unused FROM dbstat GROUP BY name")
      .all() as Array<{ name: string; bytes: number; unused: number }>;
    const tables = new Map<string, TableAccount>();
    const tableOf = (name: string) => {
      let entry = tables.get(name);
      if (!entry) {
        entry = { table: name, rows: 0, pageBytes: 0, indexBytes: 0, unusedBytes: 0, logical: {} };
        tables.set(name, entry);
      }
      return entry;
    };
    for (const row of stat) {
      const object = owner.get(row.name);
      const entry = tableOf(object?.tbl_name ?? row.name);
      if (object?.type === "table" || !object) {
        entry.pageBytes += Number(row.bytes);
        entry.unusedBytes += Number(row.unused);
      } else entry.indexBytes += Number(row.bytes);
    }

    const resolveProvider = providerResolver(db);
    const perThread: Record<string, Bytes> = {};
    const bytesByProvider: Record<string, Bytes> = {};
    const credit = (threadId: string | null, provider: string | null, bytes: Bytes) => {
      if (threadId) {
        const t = (perThread[threadId] ??= {});
        for (const [c, n] of Object.entries(bytes)) addTo(t, c as Cls, n);
      }
      if (provider) {
        const p = (bytesByProvider[provider] ??= {});
        for (const [c, n] of Object.entries(bytes)) addTo(p, c as Cls, n);
      }
    };

    // 1. Event log: latest row per snapshot key is canonical; earlier rows are duplicates.
    const latest = new Map<string, number>();
    const eventsTable = tableOf("orchestration_events");
    const columns = (
      db.prepare("PRAGMA table_info(orchestration_events)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    const otherSize = columns
      .filter((c) => c !== "payload_json")
      .map((c) => `COALESCE(LENGTH(CAST(${quote(c)} AS BLOB)),0)`)
      .join("+");
    const select = db.prepare(
      `SELECT sequence, stream_id, event_type, aggregate_kind, command_id, payload_json, ${otherSize} AS other FROM orchestration_events ORDER BY sequence`,
    );
    for (const row of select.iterate() as Iterable<EventRow>) {
      const key = eventKey(row, JSON.parse(row.payload_json));
      if (key) latest.set(key, row.sequence);
    }
    const eventTypes = new Map<string, { events: number; bytes: number; byClass: Bytes }>();
    const duplicateSequences: number[] = [];
    const duplicateBytesByType: Record<string, number> = {};
    for (const row of select.iterate() as Iterable<EventRow>) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const key = eventKey(row, payload);
      const payloadBytes = utf8(row.payload_json);
      let byClass: Bytes;
      if (key && latest.get(key) !== row.sequence) {
        byClass = { duplicate: payloadBytes };
        duplicateSequences.push(row.sequence);
        duplicateBytesByType[row.event_type] =
          (duplicateBytesByType[row.event_type] ?? 0) + payloadBytes;
      } else if (row.aggregate_kind !== "thread") {
        byClass = { "t3-owned": payloadBytes };
      } else byClass = classifyEventPayload(row.event_type, row.payload_json);
      const withOther = { ...byClass };
      addTo(withOther, "metadata", Number(row.other));
      eventsTable.rows++;
      for (const [c, n] of Object.entries(withOther)) addTo(eventsTable.logical, c as Cls, n);
      const typeEntry = eventTypes.get(row.event_type) ?? { events: 0, bytes: 0, byClass: {} };
      typeEntry.events++;
      typeEntry.bytes += payloadBytes + Number(row.other);
      for (const [c, n] of Object.entries(withOther)) addTo(typeEntry.byClass, c as Cls, n);
      eventTypes.set(row.event_type, typeEntry);
      const threadId = row.aggregate_kind === "thread" ? row.stream_id : null;
      const provider = threadId ? resolveProvider(threadId, payload.providerThreadId) : null;
      credit(threadId, provider, withOther);
    }

    // 2. Every other table: classify payload columns by rule, the rest by table role.
    const itemTypes = new Map<string, { rows: number; bytes: number; byClass: Bytes }>();
    for (const object of objects) {
      if (object.type !== "table" || object.name === "orchestration_events") continue;
      const name = object.name;
      const entry = tableOf(name);
      if (isFtsShadow(name) || name === "orchestration_v2_message_search") {
        const n = Number(
          (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get() as { n: number }).n,
        );
        entry.rows = n;
        // FTS shadow tables: page bytes count as metadata/index (derived from message text).
        continue;
      }
      let cols: string[];
      try {
        cols = (
          db.prepare(`PRAGMA table_info(${quote(name)})`).all() as Array<{ name: string }>
        ).map((c) => c.name);
      } catch {
        continue;
      }
      const rule: TableRule =
        TABLE_RULES[name] ??
        (name.startsWith("orchestration_v2_") || name.startsWith("projection_")
          ? { kind: "all", cls: "t3-owned" }
          : { kind: "all", cls: "t3-owned" });
      const hasPayload =
        cols.includes("payload_json") && (rule.kind === "item" || rule.kind === "keys");
      const other = cols
        .filter((c) => !(hasPayload && c === "payload_json"))
        .map((c) => `COALESCE(LENGTH(CAST(${quote(c)} AS BLOB)),0)`)
        .join("+");
      const threadCol = cols.includes("thread_id")
        ? "thread_id"
        : name === "orchestration_v2_events" && cols.includes("stream_id")
          ? "stream_id"
          : null;
      const sql = `SELECT ${hasPayload ? "payload_json" : "NULL"} AS payload_json, ${other || "0"} AS other, ${threadCol ? quote(threadCol) : "NULL"} AS thread_id FROM ${quote(name)}`;
      for (const row of db.prepare(sql).iterate() as Iterable<{
        payload_json: string | null;
        other: number;
        thread_id: string | null;
      }>) {
        entry.rows++;
        let byClass: Bytes = {};
        let provider: string | null = null;
        if (hasPayload && row.payload_json !== null) {
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          byClass =
            rule.kind === "item"
              ? classifyItem(row.payload_json)
              : classifyObject(
                  row.payload_json,
                  payload,
                  (rule as { keys: Record<string, Cls> }).keys,
                  name,
                );
          if (rule.kind === "item") {
            const type = String(payload.type);
            const it = itemTypes.get(type) ?? { rows: 0, bytes: 0, byClass: {} };
            it.rows++;
            it.bytes += utf8(row.payload_json);
            for (const [c, n] of Object.entries(byClass)) addTo(it.byClass, c as Cls, n);
            itemTypes.set(type, it);
          }
          if (row.thread_id) provider = resolveProvider(row.thread_id, payload.providerThreadId);
        }
        const metaCls: Cls =
          rule.kind === "all" ? rule.cls : rule.kind === "item" ? "metadata" : "metadata";
        addTo(byClass, metaCls, Number(row.other));
        for (const [c, n] of Object.entries(byClass)) addTo(entry.logical, c as Cls, n);
        credit(row.thread_id, provider, byClass);
      }
    }

    // Totals: logical class bytes + index pages + slack + free. Logical bytes exclude per-row and
    // per-cell overhead, which shows up as the gap between page bytes and (logical + unused).
    const totals: Record<string, number> = {};
    for (const t of tables.values()) {
      for (const [c, n] of Object.entries(t.logical)) totals[c] = (totals[c] ?? 0) + n;
      totals["index"] = (totals["index"] ?? 0) + t.indexBytes;
      totals["slack"] = (totals["slack"] ?? 0) + t.unusedBytes;
      if (isFtsShadow(t.table)) totals["fts"] = (totals["fts"] ?? 0) + t.pageBytes - t.unusedBytes;
      const logical = Object.values(t.logical).reduce((a, b) => a + b, 0);
      if (!isFtsShadow(t.table))
        totals["cell-overhead"] =
          (totals["cell-overhead"] ?? 0) + t.pageBytes - t.unusedBytes - logical;
    }
    totals["free"] = freeBytes;
    return {
      db: dbPath,
      fileBytes: NodeFS.statSync(dbPath).size,
      pageSize,
      freeBytes,
      tables: [...tables.values()].sort(
        (a, b) => b.pageBytes + b.indexBytes - (a.pageBytes + a.indexBytes),
      ),
      totals,
      eventTypes: [...eventTypes]
        .map(([eventType, v]) => ({ eventType, ...v }))
        .sort((a, b) => b.bytes - a.bytes),
      itemTypes: [...itemTypes]
        .map(([itemType, v]) => ({ itemType, ...v }))
        .sort((a, b) => b.bytes - a.bytes),
      duplicateSequences,
      duplicateBytesByType,
      bytesByProvider,
      perThread,
    };
  } finally {
    db.close();
  }
}

// Policy simulation on a copy: rewrite payloads in place, then VACUUM and measure the real file.

const tombstoneValue = (cls: Cls, value: unknown) => {
  const s = JSON.stringify(value);
  return { $evicted: cls, bytes: utf8(s), sha256: sha256(s) };
};

/** Policy A on one item: heavy keys (tool output; inline base64 anywhere) become tombstones. */
function evictHeavy(payload: Record<string, unknown>): boolean {
  const type = String(payload.type ?? "");
  if (T3_OWNED_ITEM_TYPES.has(type)) return false;
  const keys = TEXT_KEYS[type] ?? {};
  let changed = false;
  for (const [key, value] of Object.entries(payload)) {
    if (keys[key] === "tool-output" && value !== null && value !== undefined) {
      payload[key] = tombstoneValue("tool-output", value);
      changed = true;
    }
  }
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.length >= 256 && BASE64.test(v)) {
        changed = true;
        return tombstoneValue("image", v);
      }
      return v;
    }
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(scrub);
    if ("$evicted" in (v as object)) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  };
  for (const [key, value] of Object.entries(payload)) payload[key] = scrub(value);
  return changed;
}

/** Row tombstone: id, type, run, position, status, size, hash (owner spec). */
function rowTombstone(raw: string, cls: Cls): string {
  const p = JSON.parse(raw) as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  for (const k of ["id", "type", "role", "runId", "ordinal", "status", "messageId"])
    if (k in p) keep[k] = p[k];
  keep.$evicted = cls;
  keep.bytes = utf8(raw);
  keep.sha256 = sha256(raw);
  return JSON.stringify(keep);
}

export type Policy = "A" | "B";

export function simulate(
  source: string,
  target: string,
  policy: Policy,
  duplicateSequences: ReadonlySet<number>,
) {
  for (const s of ["", "-wal", "-shm"]) NodeFS.rmSync(target + s, { force: true });
  const src = new NodeSqlite.DatabaseSync(source, { readOnly: true });
  src.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  src.close();
  const db = new NodeSqlite.DatabaseSync(target);
  // Throwaway copy: drop triggers so rewrites do not churn the FTS index (B clears it below).
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as Array<{
    name: string;
  }>)
    db.exec(`DROP TRIGGER ${quote(t.name)}`);
  const counts = {
    eventTombstones: 0,
    eventHeavy: 0,
    itemTombstones: 0,
    itemHeavy: 0,
    messageTombstones: 0,
  };
  db.exec("BEGIN");
  const updateEvent = db.prepare(
    "UPDATE orchestration_events SET payload_json = ? WHERE sequence = ?",
  );
  const transcriptItem = (p: Record<string, unknown>) =>
    !T3_OWNED_ITEM_TYPES.has(String(p.type ?? ""));
  for (const row of db
    .prepare(
      "SELECT sequence, event_type, aggregate_kind, payload_json FROM orchestration_events WHERE aggregate_kind = 'thread'",
    )
    .all() as Array<{ sequence: number; event_type: string; payload_json: string }>) {
    if (duplicateSequences.has(row.sequence)) {
      updateEvent.run(rowTombstone(row.payload_json, "duplicate"), row.sequence);
      counts.eventTombstones++;
      continue;
    }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (policy === "B") {
      if (
        (row.event_type === "turn-item.updated" && transcriptItem(payload)) ||
        row.event_type === "message.updated" ||
        row.event_type === "plan.updated"
      ) {
        updateEvent.run(rowTombstone(row.payload_json, "message-text"), row.sequence);
        counts.eventTombstones++;
      } else if (row.event_type === "context-handoff.updated") {
        for (const k of Object.keys(HANDOFF_KEYS))
          if (k in payload) payload[k] = tombstoneValue("message-text", payload[k]);
        updateEvent.run(JSON.stringify(payload), row.sequence);
      }
    } else if (row.event_type === "turn-item.updated" && evictHeavy(payload)) {
      updateEvent.run(JSON.stringify(payload), row.sequence);
      counts.eventHeavy++;
    }
  }
  const updateItem = db.prepare(
    "UPDATE orchestration_v2_projection_turn_items SET payload_json = ? WHERE rowid = ?",
  );
  for (const row of db
    .prepare("SELECT rowid AS id, payload_json FROM orchestration_v2_projection_turn_items")
    .all() as Array<{ id: number; payload_json: string }>) {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (policy === "B" && transcriptItem(payload)) {
      updateItem.run(rowTombstone(row.payload_json, "message-text"), row.id);
      counts.itemTombstones++;
    } else if (policy === "A" && evictHeavy(payload)) {
      updateItem.run(JSON.stringify(payload), row.id);
      counts.itemHeavy++;
    }
  }
  if (policy === "B") {
    for (const table of [
      "orchestration_v2_projection_messages",
      "orchestration_v2_projection_plans",
    ]) {
      const update = db.prepare(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`);
      for (const row of db
        .prepare(`SELECT rowid AS id, payload_json FROM ${table}`)
        .all() as Array<{
        id: number;
        payload_json: string;
      }>) {
        update.run(rowTombstone(row.payload_json, "message-text"), row.id);
        counts.messageTombstones++;
      }
    }
    const update = db.prepare(
      "UPDATE orchestration_v2_projection_context_handoffs SET payload_json = ? WHERE rowid = ?",
    );
    for (const row of db
      .prepare("SELECT rowid AS id, payload_json FROM orchestration_v2_projection_context_handoffs")
      .all() as Array<{ id: number; payload_json: string }>) {
      const p = JSON.parse(row.payload_json) as Record<string, unknown>;
      for (const k of Object.keys(HANDOFF_KEYS))
        if (k in p) p[k] = tombstoneValue("message-text", p[k]);
      update.run(JSON.stringify(p), row.id);
    }
    // Search regresses to resident threads under B (S5 option b): drop the FTS index contents.
    const fts = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='orchestration_v2_message_search'",
      )
      .get();
    if (fts)
      db.exec(
        "INSERT INTO orchestration_v2_message_search(orchestration_v2_message_search) VALUES('delete-all')",
      );
  }
  // Legacy duplicate tables (R8): pre-0.1 V2 event copy and the V1 message projection.
  for (const table of [
    "orchestration_v2_events",
    "projection_thread_messages",
    "mcp_app_model_context",
  ]) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (exists && (policy === "B" || table !== "mcp_app_model_context"))
      db.exec(`DELETE FROM ${table}`);
  }
  db.exec("COMMIT");
  db.exec("VACUUM");
  db.close();
  return counts;
}

function vacuumCopy(source: string, target: string) {
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  for (const s of ["", "-wal", "-shm"]) NodeFS.rmSync(target + s, { force: true });
  const db = new NodeSqlite.DatabaseSync(source, { readOnly: true });
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  db.close();
}

async function prepare(seed: string, work: string) {
  const migrateHome = NodePath.join(work, "migrate");
  const prepared = prepareHome({ seed, t3Home: migrateHome });
  const benchHome = NodePath.join(work, "bench-home");
  const started = performance.now();
  const server = await startServer({
    t3Home: migrateHome,
    benchHome,
    logPath: NodePath.join(work, "migrate-boot.log"),
  });
  console.log(`migration boot pid ${server.pid} ready in ${Math.round(server.startupMs)} ms`);
  // Let boot-time reactors settle, then stop exactly the process group we started.
  await new Promise((done) => setTimeout(done, 20_000));
  await server.stop();
  console.log(`migration boot done in ${Math.round(performance.now() - started)} ms`);
  const base = NodePath.join(work, "base", "userdata", "statev2.sqlite");
  vacuumCopy(prepared.db, base);
  const doctorDb = NodePath.join(work, "doctor", "userdata", "statev2.sqlite");
  vacuumCopy(prepared.db, doctorDb);
  NodeFS.rmSync(migrateHome, { recursive: true, force: true });
  // The real CLI. Its service pause only touches a boot service installed for this base dir.
  const doctor = NodeChildProcess.spawnSync(
    process.execPath,
    ["apps/server/src/bin.ts", "doctor", "--base-dir", NodePath.join(work, "doctor"), "--fix"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, T3CODE_TELEMETRY_ENABLED: "false" } },
  );
  NodeFS.writeFileSync(NodePath.join(work, "doctor.log"), `${doctor.stdout}\n${doctor.stderr}`);
  console.log(doctor.stdout.trim());
  if (doctor.status !== 0)
    throw new Error(`doctor exited ${doctor.status}; see ${work}/doctor.log`);
}

const sumBytes = (b: Bytes) => Object.values(b).reduce((a, n) => a + (n ?? 0), 0);

function threadStats(account: Account, threadIds: ReadonlySet<string>) {
  const sorted = Object.entries(account.perThread)
    .filter(([id]) => threadIds.has(id))
    .map(([, b]) => sumBytes(b))
    .sort((a, b) => a - b);
  return {
    count: sorted.length,
    total: sorted.reduce((a, b) => a + b, 0),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    max: sorted.at(-1) ?? 0,
  };
}

function liveThreadIds(dbPath: string): Set<string> {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  const ids = (
    db
      .prepare("SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NULL")
      .all() as Array<{ thread_id: string }>
  ).map((r) => r.thread_id);
  db.close();
  return new Set(ids);
}

async function analyze(work: string, out: string) {
  NodeFS.mkdirSync(out, { recursive: true });
  const base = NodePath.join(work, "base", "userdata", "statev2.sqlite");
  const doctorDb = NodePath.join(work, "doctor", "userdata", "statev2.sqlite");
  const threads = liveThreadIds(base);
  const timed = <T>(label: string, f: () => T): T => {
    const t = performance.now();
    const r = f();
    console.log(`${label}: ${Math.round(performance.now() - t)} ms`);
    return r;
  };
  const baseAccount = timed("account base", () => account(base));
  const doctorAccount = timed("account doctor", () => account(doctorDb));

  // What doctor removed, classified with the base classifier: sequences present in base only.
  const doctorSeqs = new Set<number>();
  {
    const db = new NodeSqlite.DatabaseSync(doctorDb, { readOnly: true });
    for (const r of db.prepare("SELECT sequence FROM orchestration_events").iterate() as Iterable<{
      sequence: number;
    }>)
      doctorSeqs.add(r.sequence);
    db.close();
  }
  const removedByDoctor: Record<string, { events: number; bytes: number; byClass: Bytes }> = {};
  {
    const db = new NodeSqlite.DatabaseSync(base, { readOnly: true });
    const dup = new Set(baseAccount.duplicateSequences);
    for (const r of db
      .prepare(
        "SELECT sequence, event_type, aggregate_kind, payload_json FROM orchestration_events",
      )
      .iterate() as Iterable<{
      sequence: number;
      event_type: string;
      aggregate_kind: string;
      payload_json: string;
    }>) {
      if (doctorSeqs.has(r.sequence)) continue;
      const e = (removedByDoctor[r.event_type] ??= { events: 0, bytes: 0, byClass: {} });
      e.events++;
      e.bytes += utf8(r.payload_json);
      const cls: Bytes = dup.has(r.sequence)
        ? { duplicate: utf8(r.payload_json) }
        : classifyEventPayload(r.event_type, r.payload_json);
      for (const [c, n] of Object.entries(cls)) addTo(e.byClass, c as Cls, n);
    }
    db.close();
  }

  const dupAfterDoctor = new Set(doctorAccount.duplicateSequences);
  const simA = NodePath.join(work, "policy-a.sqlite");
  const simB = NodePath.join(work, "policy-b.sqlite");
  const countsA = timed("simulate A", () => simulate(doctorDb, simA, "A", dupAfterDoctor));
  const countsB = timed("simulate B", () => simulate(doctorDb, simB, "B", dupAfterDoctor));
  const accountA = timed("account A", () => account(simA));
  const accountB = timed("account B", () => account(simB));
  const durable = Object.fromEntries(
    [
      ["base", base],
      ["doctor", doctorDb],
      ["policyA", simA],
      ["policyB", simB],
    ].map(([k, p]) => {
      const r = measureDurable(p!);
      return [k, { fileBytes: r.fileBytes.db, threadSummary: r.threadSummary }];
    }),
  );

  const strip = (a: Account) => {
    const { duplicateSequences: _d, perThread: _p, ...rest } = a;
    return {
      ...rest,
      duplicateEvents: a.duplicateSequences.length,
      threads: threadStats(a, threads),
    };
  };
  const result = {
    sha: NodeChildProcess.execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim(),
    at: new Date().toISOString(),
    work,
    unlistedLargeKeys: Object.fromEntries([...unlisted].sort((a, b) => b[1] - a[1]).slice(0, 30)),
    base: strip(baseAccount),
    doctor: strip(doctorAccount),
    removedByDoctor,
    policyA: { counts: countsA, ...strip(accountA) },
    policyB: { counts: countsB, ...strip(accountB) },
    durable,
  };
  NodeFS.writeFileSync(NodePath.join(out, "accounting.json"), JSON.stringify(result, null, 2));
  // Per-thread table for later experiments (bytes per class per thread, all four DBs).
  const perThread = [...threads].map((id) => ({
    threadId: id,
    base: baseAccount.perThread[id] ?? {},
    doctor: doctorAccount.perThread[id] ?? {},
    policyA: accountA.perThread[id] ?? {},
    policyB: accountB.perThread[id] ?? {},
  }));
  NodeFS.writeFileSync(NodePath.join(out, "per-thread.json"), JSON.stringify(perThread));
  console.log(`wrote ${out}/accounting.json`);
}

// Re-serve matrix: which classes a provider can hand back. "today" = what the adapter's
// readThreadSnapshot returns if something called it (nothing in production does, SURFACE-MAP §2).
// "ceiling" = what the provider's native protocol or store holds, verified in source; unverified
// capabilities count as 0. Citations are in 01-accounting.md.
const TEXT: Cls[] = ["message-text", "reasoning-text"];
const ALL: Cls[] = ["message-text", "reasoning-text", "tool-input", "tool-output", "image"];
const RESERVE: Array<{ match: RegExp; family: string; today: Cls[]; ceiling: Cls[] }> = [
  // Hermes advertises loadSession and replays text, thoughts and tool start/complete with string
  // results; T3's ACP adapter drops tool_call/tool_call_update during load.
  {
    match: /^acpRegistry\/hermes/,
    family: "ACP / Hermes",
    today: TEXT,
    ceiling: ["message-text", "reasoning-text", "tool-input", "tool-output"],
  },
  // Other ACP agents (omp, grok via the ACP adapter): loadSession support not verified here.
  { match: /^(acpRegistry\/|grok$)/, family: "ACP / other (omp, grok)", today: [], ceiling: [] },
  // Codex: readThreadSnapshot returns messages: []; thread/items/list carries items incl. output.
  { match: /^codex/, family: "Codex", today: [], ceiling: ALL.filter((c) => c !== "image") },
  // Claude: adapter fails; JSONL holds text and tool_result blocks. Imports reuse the scanner
  // (user/assistant text only, capped at 200 messages).
  { match: /^claude-import$/, family: "Claude", today: ["message-text"], ceiling: ALL },
  { match: /^claudeAgent$/, family: "Claude", today: [], ceiling: ALL },
  // Cursor: listMessages, text only. OpenCode: session.messages (tool parts not verified).
  { match: /^cursor/, family: "Cursor", today: ["message-text"], ceiling: ["message-text"] },
  { match: /^opencode/, family: "OpenCode", today: ["message-text"], ceiling: ["message-text"] },
  { match: /.*/, family: "other / none", today: [], ceiling: [] },
];

const MiB = (n: number) => `${(n / 2 ** 20).toFixed(1)} MiB`;
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(0)}%`);

function render(
  resultPath: string,
  ledgerPath: string | undefined,
  rawDir: string,
  measuredSha: string,
) {
  const r = JSON.parse(NodeFS.readFileSync(resultPath, "utf8"));
  const lines: string[] = [];
  const dbs = ["base", "doctor", "policyA", "policyB"] as const;
  const label = {
    base: "origin/main after migrations (VACUUM'd)",
    doctor: "+ `t3 doctor --fix`",
    policyA: "+ policy A: keep text, evict heavy",
    policyB: "+ policy B: provider owns everything",
  };
  lines.push("| DB | file | vs doctor | per-thread p50 | p90 | max | attributed total |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const k of dbs) {
    const d = r.durable[k];
    const t = d.threadSummary;
    lines.push(
      `| ${label[k]} | ${MiB(d.fileBytes)} | ${k === "base" ? "" : `${MiB(d.fileBytes - r.durable.doctor.fileBytes)} (${pct(d.fileBytes - r.durable.doctor.fileBytes, r.durable.doctor.fileBytes)})`} | ${MiB(t.p50)} | ${MiB(t.p90)} | ${MiB(t.max)} | ${MiB(t.total)} |`,
    );
  }
  lines.push("");
  const rows = [
    "message-text",
    "reasoning-text",
    "tool-input",
    "tool-output",
    "image",
    "duplicate",
    "t3-owned",
    "metadata",
    "fts",
    "index",
    "cell-overhead",
    "slack",
    "free",
  ];
  lines.push(`| class | ${dbs.join(" | ")} |`);
  lines.push(`|---|${dbs.map(() => "---").join("|")}|`);
  for (const c of rows)
    lines.push(`| ${c} | ${dbs.map((k) => MiB(r[k].totals[c] ?? 0)).join(" | ")} |`);
  lines.push(
    `| **sum** | ${dbs.map((k) => MiB(Object.values(r[k].totals as Record<string, number>).reduce((a, b) => a + b, 0))).join(" | ")} |`,
  );
  lines.push(`| file | ${dbs.map((k) => MiB(r[k].fileBytes)).join(" | ")} |`);
  lines.push("");
  // Re-serve: evicted bytes per provider family, from the doctor DB (the policy input).
  const fam = new Map<
    string,
    {
      a: number;
      aToday: number;
      aCeil: number;
      b: number;
      bToday: number;
      bCeil: number;
      dup: number;
      keys: Set<string>;
    }
  >();
  for (const [provider, bytes] of Object.entries(
    r.doctor.bytesByProvider as Record<string, Bytes>,
  )) {
    const rule = RESERVE.find((x) => x.match.test(provider))!;
    const e = fam.get(rule.family) ?? {
      a: 0,
      aToday: 0,
      aCeil: 0,
      b: 0,
      bToday: 0,
      bCeil: 0,
      dup: 0,
      keys: new Set(),
    };
    e.keys.add(provider);
    e.dup += bytes.duplicate ?? 0;
    for (const c of ["tool-output", "image"] as Cls[]) {
      const n = bytes[c] ?? 0;
      e.a += n;
      if (rule.today.includes(c)) e.aToday += n;
      if (rule.ceiling.includes(c)) e.aCeil += n;
    }
    for (const c of ALL) {
      const n = bytes[c] ?? 0;
      e.b += n;
      if (rule.today.includes(c)) e.bToday += n;
      if (rule.ceiling.includes(c)) e.bCeil += n;
    }
    fam.set(rule.family, e);
  }
  lines.push(
    "| provider family (instances) | A: heavy bytes evicted | re-servable today | ceiling | duplicates (self-recoverable) | B: transcript bytes evicted | re-servable today | ceiling |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  const tot = { a: 0, aToday: 0, aCeil: 0, b: 0, bToday: 0, bCeil: 0, dup: 0 };
  for (const [family, e] of [...fam].sort((x, y) => y[1].a + y[1].b - (x[1].a + x[1].b))) {
    for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += e[k];
    lines.push(
      `| ${family} (${[...e.keys].join(", ")}) | ${MiB(e.a)} | ${pct(e.aToday, e.a)} | ${pct(e.aCeil, e.a)} | ${MiB(e.dup)} | ${MiB(e.b)} | ${pct(e.bToday, e.b)} | ${pct(e.bCeil, e.b)} |`,
    );
  }
  lines.push(
    `| **all** | ${MiB(tot.a)} | ${pct(tot.aToday, tot.a)} | ${pct(tot.aCeil, tot.a)} | ${MiB(tot.dup)} | ${MiB(tot.b)} | ${pct(tot.bToday, tot.b)} | ${pct(tot.bCeil, tot.b)} |`,
  );
  lines.push("");
  lines.push("| removed by doctor (event type) | events | payload bytes | classes |");
  lines.push("|---|---|---|---|");
  for (const [t, v] of Object.entries(
    r.removedByDoctor as Record<string, { events: number; bytes: number; byClass: Bytes }>,
  ).sort((a, b) => b[1].bytes - a[1].bytes))
    lines.push(
      `| ${t} | ${v.events} | ${MiB(v.bytes)} | ${Object.entries(v.byClass)
        .map(([c, n]) => `${c} ${MiB(n ?? 0)}`)
        .join(", ")} |`,
    );
  lines.push("");
  lines.push("| superseded snapshot bodies left after doctor (event type) | payload bytes |");
  lines.push("|---|---|");
  for (const [t, n] of Object.entries(r.doctor.duplicateBytesByType as Record<string, number>).sort(
    (a, b) => b[1] - a[1],
  ))
    lines.push(`| ${t} | ${MiB(n)} |`);
  lines.push("");
  lines.push(
    "| item type (doctor DB, projection) | rows | payload | message/reasoning text | tool-input | tool-output | metadata | t3-owned |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const it of r.doctor.itemTypes as Array<{
    itemType: string;
    rows: number;
    bytes: number;
    byClass: Bytes;
  }>)
    lines.push(
      `| ${it.itemType} | ${it.rows} | ${MiB(it.bytes)} | ${MiB((it.byClass["message-text"] ?? 0) + (it.byClass["reasoning-text"] ?? 0))} | ${MiB(it.byClass["tool-input"] ?? 0)} | ${MiB(it.byClass["tool-output"] ?? 0)} | ${MiB(it.byClass.metadata ?? 0)} | ${MiB(it.byClass["t3-owned"] ?? 0)} |`,
    );
  lines.push("");
  lines.push(
    "| table (doctor DB) | rows | table pages | index pages | slack | message+reasoning | tool-output | duplicate | metadata | t3-owned |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const t of (r.doctor.tables as TableAccount[]).filter(
    (x) => x.pageBytes + x.indexBytes >= 256 * 1024,
  ))
    lines.push(
      `| ${t.table} | ${t.rows} | ${MiB(t.pageBytes)} | ${MiB(t.indexBytes)} | ${MiB(t.unusedBytes)} | ${MiB((t.logical["message-text"] ?? 0) + (t.logical["reasoning-text"] ?? 0))} | ${MiB(t.logical["tool-output"] ?? 0)} | ${MiB(t.logical.duplicate ?? 0)} | ${MiB(t.logical.metadata ?? 0)} | ${MiB(t.logical["t3-owned"] ?? 0)} |`,
    );
  const md = lines.join("\n");
  if (ledgerPath) {
    const at = new Date().toISOString();
    const raw = NodePath.join(rawDir, "accounting.json");
    const rowsOut: string[] = [];
    const push = (flag: string, metric: string, unit: string, n: number, value: number) =>
      rowsOut.push(
        JSON.stringify({
          experiment: "01-byte-accounting",
          sha: measuredSha,
          harness: r.sha,
          flag,
          metric,
          unit,
          n,
          p50: value,
          p95: value,
          raw,
          at,
        }),
      );
    for (const k of dbs) {
      const d = r.durable[k];
      push(k, "durable.file.bytes", "bytes", 1, d.fileBytes);
      push(
        k,
        "durable.thread_payload.total.bytes",
        "bytes",
        d.threadSummary.count,
        d.threadSummary.total,
      );
      push(
        k,
        "durable.thread_payload.p50.bytes",
        "bytes",
        d.threadSummary.count,
        d.threadSummary.p50,
      );
      push(
        k,
        "durable.thread_payload.p90.bytes",
        "bytes",
        d.threadSummary.count,
        d.threadSummary.p90,
      );
      push(
        k,
        "durable.thread_payload.max.bytes",
        "bytes",
        d.threadSummary.count,
        d.threadSummary.max,
      );
      for (const c of rows) push(k, `durable.class.${c}.bytes`, "bytes", 1, r[k].totals[c] ?? 0);
    }
    push("policyA", "reserve.evicted.bytes", "bytes", 1, tot.a);
    push("policyA", "reserve.today.fraction", "ratio", 1, tot.a ? tot.aToday / tot.a : 0);
    push("policyA", "reserve.ceiling.fraction", "ratio", 1, tot.a ? tot.aCeil / tot.a : 0);
    push("policyB", "reserve.evicted.bytes", "bytes", 1, tot.b);
    push("policyB", "reserve.today.fraction", "ratio", 1, tot.b ? tot.bToday / tot.b : 0);
    push("policyB", "reserve.ceiling.fraction", "ratio", 1, tot.b ? tot.bCeil / tot.b : 0);
    NodeFS.appendFileSync(ledgerPath, rowsOut.join("\n") + "\n");
    console.error(`appended ${rowsOut.length} ledger rows to ${ledgerPath}`);
  }
  return md;
}

if (import.meta.main) {
  const { positionals, values } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      seed: { type: "string" },
      work: { type: "string" },
      out: { type: "string" },
      md: { type: "string" },
      ledger: { type: "string" },
      sha: { type: "string" },
    },
  });
  const work = NodePath.resolve(values.work ?? NodePath.join(repoRoot, ".t3/bench/accounting"));
  const out = NodePath.resolve(values.out ?? NodePath.join(work, "out"));
  if (positionals[0] === "prepare") await prepare(NodePath.resolve(values.seed!), work);
  else if (positionals[0] === "analyze") await analyze(work, out);
  else if (positionals[0] === "report") {
    const measuredSha =
      values.sha ??
      NodeChildProcess.execSync("git merge-base HEAD origin/main", {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
    const md = render(NodePath.join(out, "accounting.json"), values.ledger, out, measuredSha);
    if (values.md) NodeFS.writeFileSync(values.md, md + "\n");
    else console.log(md);
  } else
    throw new Error(
      "usage: accounting.ts prepare --seed <db> --work <dir> | analyze --work <dir> --out <dir> | report --out <dir> [--md f] [--ledger f]",
    );
}
