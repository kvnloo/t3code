#!/usr/bin/env python3
"""EXPLAIN QUERY PLAN for the hot orchestration_events queries before and after trimming
idx_orch_events_correlation_id (drop) and idx_orch_events_command_id (partial: command_id IS NOT
NULL). PoH P2/04. Works on a COPY of a seed; it modifies the file it is given.

usage: idx-plan.py <seed copy .sqlite> [--json out.json]
"""
import json, sqlite3, sys

path = sys.argv[1]
out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
db = sqlite3.connect(path)
thread = db.execute(
    "SELECT stream_id FROM orchestration_events WHERE aggregate_kind='thread' "
    "GROUP BY stream_id ORDER BY COUNT(*) DESC LIMIT 1"
).fetchone()[0]
command = db.execute(
    "SELECT command_id FROM orchestration_events WHERE command_id IS NOT NULL LIMIT 1"
).fetchone()[0]
hi = db.execute("SELECT MAX(sequence) FROM orchestration_events").fetchone()[0]

COLS = ("sequence, event_id, command_id, aggregate_kind, stream_id, event_type, occurred_at, "
        "payload_json, metadata_json, application_event_version, causation_event_id, correlation_id")
APP = "(aggregate_kind = 'project' OR (application_event_version = 2 AND aggregate_kind = 'thread'))"
AGENT = "(application_event_version = 2 AND aggregate_kind = 'thread')"
# Sources: persistence/OrchestrationEventStore.ts (readAgentEvents, latestAgentSequence,
# latestApplicationSequence, getReplayStats, append), orchestration-v2/ProjectionMaintenance.ts,
# ThreadFind.ts. Literal values stand in for bound parameters.
QUERIES = {
    "readAgentEvents(commandId)": (
        f"SELECT {COLS} FROM orchestration_events INDEXED BY idx_orch_events_command_id "
        f"WHERE sequence > 0 AND sequence <= {hi} AND {APP} AND command_id = ? "
        "ORDER BY sequence ASC LIMIT 256", (command,)),
    "readAgentEvents(threadId, catch-up)": (
        f"SELECT {COLS} FROM orchestration_events "
        "INDEXED BY idx_orchestration_events_application_high_water "
        f"WHERE sequence > {hi - 500} AND sequence <= {hi} AND {APP} AND stream_id = ? "
        "ORDER BY sequence ASC LIMIT 256", (thread,)),
    "readAgentEvents(onlyAgent, threadId)": (
        f"SELECT {COLS} FROM orchestration_events "
        f"WHERE sequence > 0 AND sequence <= {hi} AND {AGENT} AND stream_id = ? "
        "ORDER BY sequence ASC LIMIT 256", (thread,)),
    "readAgentEvents(eventType)": (
        f"SELECT {COLS} FROM orchestration_events "
        "INDEXED BY idx_orchestration_events_application_high_water "
        f"WHERE sequence > 0 AND sequence <= {hi} AND {APP} AND event_type = 'run.updated' "
        "ORDER BY sequence ASC LIMIT 256", ()),
    "latestAgentSequence()": (
        "SELECT MAX(sequence) FROM orchestration_events "
        f"INDEXED BY idx_orchestration_events_application_sequence WHERE {AGENT}", ()),
    "latestAgentSequence(threadId)": (
        "SELECT MAX(sequence) FROM orchestration_events "
        f"INDEXED BY idx_orchestration_events_agent_stream_sequence WHERE {AGENT} AND stream_id = ?",
        (thread,)),
    "latestApplicationSequence": (
        "SELECT MAX(sequence) FROM orchestration_events "
        f"INDEXED BY idx_orchestration_events_application_high_water WHERE {APP}", ()),
    "getReplayStats": (
        "SELECT COUNT(*), SUM(length(payload_json)) FROM orchestration_events "
        "INDEXED BY idx_orchestration_events_application_high_water "
        f"WHERE sequence > {hi - 500} AND sequence <= {hi} AND {APP}", ()),
    "snapshot sequence (thread)": (
        "SELECT MAX(sequence) FROM orchestration_events "
        "WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ?",
        (thread,)),
    "stream version (append)": (
        "SELECT MAX(stream_version) FROM orchestration_events "
        "WHERE aggregate_kind = 'thread' AND stream_id = ?", (thread,)),
    "compaction entity scan (command_id IS NULL)": (
        "SELECT event.sequence FROM orchestration_events AS event "
        f"WHERE event.sequence > 0 AND event.sequence <= {hi} AND event.application_event_version = 2 "
        "AND event.event_type = 'turn-item.updated' AND event.command_id IS NULL "
        "ORDER BY event.sequence LIMIT 512", ()),
    "ThreadFind max sequence": ("SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events", ()),
}


def plans():
    result = {}
    for name, (sql, params) in QUERIES.items():
        try:
            rows = db.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
            result[name] = [r[3] for r in rows]
        except sqlite3.Error as error:
            result[name] = [f"ERROR {error}"]
    return result


def index_pages(name):
    try:
        return db.execute("SELECT COUNT(*) FROM dbstat WHERE name = ?", (name,)).fetchone()[0]
    except sqlite3.Error:
        return None


before = plans()
sizes = {n: index_pages(n) for n in ("idx_orch_events_correlation_id", "idx_orch_events_command_id")}
db.execute("DROP INDEX idx_orch_events_correlation_id")
db.execute("DROP INDEX idx_orch_events_command_id")
db.execute("CREATE INDEX idx_orch_events_command_id ON orchestration_events(command_id) "
           "WHERE command_id IS NOT NULL")
db.commit()
after = plans()
sizes_after = {"idx_orch_events_command_id": index_pages("idx_orch_events_command_id")}
report = {"thread": thread, "pagesBefore": sizes, "pagesAfter": sizes_after,
          "queries": {n: {"before": before[n], "after": after[n], "same": before[n] == after[n]}
                      for n in QUERIES}}
for n, r in report["queries"].items():
    mark = "same" if r["same"] else "CHANGED"
    print(f"[{mark}] {n}\n   before: {' | '.join(r['before'])}\n   after:  {' | '.join(r['after'])}")
print("index pages before", sizes, "after", sizes_after)
if out:
    json.dump(report, open(out, "w"), indent=1)
