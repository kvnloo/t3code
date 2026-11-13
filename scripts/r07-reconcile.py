#!/usr/bin/env python3
"""Reconcile R07's five historical receipts without requests or state writes."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

PROBES = (
    "opus-default-route-probe.jsonl",
    "opus-sub2-route-probe.jsonl",
    "opus-sub2-route-probe-2.jsonl",
    "directsdk-smoke.jsonl",
    "directsdk-default-smoke.jsonl",
)
CRON_ID = "local-317fbfb72a856870464c9a96adb1e6421d62590452d86303cf22770ec95a6071"
SESSION_SQL = """SELECT id,source,created_source,model,billing_provider,billing_mode,
    tool_call_count,api_call_count,input_tokens,output_tokens,end_reason,
    started_at,ended_at,profile_name,transport_profile
    FROM sessions WHERE id=?"""
USAGE_SQL = """SELECT model,billing_provider,billing_mode,task,api_call_count,
    input_tokens,output_tokens FROM session_model_usage WHERE session_id=?
    ORDER BY model,billing_provider,task"""
MESSAGE_SQL = """SELECT id,role,tool_name,tool_call_id,tool_calls,finish_reason,
    effect_disposition,length(content) AS content_characters
    FROM messages WHERE session_id=? ORDER BY timestamp,id"""
T3_SQL = """SELECT provider_thread_id,thread_id,provider,provider_session_id,
    json_extract(payload_json,'$.nativeThreadRef.nativeId') AS native_thread_id,
    status,driver,provider_instance_id FROM orchestration_v2_projection_provider_threads
    WHERE ? IN (provider_session_id,json_extract(payload_json,'$.nativeThreadRef.nativeId'))
    ORDER BY provider_thread_id"""


def readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("BEGIN")
    return connection


def rows(connection, sql, session_id):
    return [dict(row) for row in connection.execute(sql, (session_id,))]


def receipt(path):
    events = []
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.startswith("{"):
            continue  # The CLI also writes Session: lines to these historical files.
        event = json.loads(line)
        events.append((number, event))
    init = [event for _, event in events if event.get("subtype") == "init"]
    results = [(number, event) for number, event in events if event.get("type") == "result"]
    if len(init) != 1 or len(results) != 1 or events[-1] != results[0]:
        raise ValueError(f"Expected one init and one final result in {path}")
    number, result = results[0]
    return {
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "init_model_label": init[0].get("model"),
        "session_id": result.get("session_id"),
        "last_event_type": result["type"],
        "last_event_line": number,
        "exit_code": result.get("exit_code"),
        "error": result.get("error"),
        "tokens": result.get("tokens"),
        "duration_ms": result.get("duration_ms"),
    }


def native(connection, t3, session_id):
    sessions = rows(connection, SESSION_SQL, session_id)
    if len(sessions) != 1:
        raise ValueError(f"Expected one native row for {session_id}, got {len(sessions)}")
    session = sessions[0]
    usage = rows(connection, USAGE_SQL, session_id)
    messages = rows(connection, MESSAGE_SQL, session_id)
    calls = []
    for message in messages:
        raw_calls = message.pop("tool_calls")
        message["tool_calls"] = []
        for call in json.loads(raw_calls or "[]"):
            function = call.get("function", {})
            summary = {
                "id": call.get("id"),
                "name": function.get("name"),
                "arguments_sha256": hashlib.sha256(
                    function.get("arguments", "").encode()
                ).hexdigest(),
            }
            message["tool_calls"].append(summary)
            calls.append(summary)
    response_ids = [message["tool_call_id"] for message in messages if message["role"] == "tool"]
    paired = bool(calls) and all(call["id"] in response_ids for call in calls)
    keys = ("input_tokens", "output_tokens", "api_call_count")
    chat_usage = [row for row in usage if row["task"] == ""]
    totals_match = all(session[key] == sum(row[key] for row in chat_usage) for key in keys)
    return {
        "session": session,
        "model_usage": usage,
        "messages_without_content_or_arguments": messages,
        "chat_task_usage_totals_match_session": totals_match,
        "usage_comparison_scope": "task='' only; title_generation is auxiliary, not proof of chat fallback",
        "tool_calls_have_responses": paired,
        "last_message_is_assistant_stop": bool(messages) and messages[-1]["role"] == "assistant"
        and messages[-1]["finish_reason"] == "stop",
        "t3_thread_matches": rows(t3, T3_SQL, session_id),
        "account_identity_proven": False,
        "installed_affected_app_proven": False,
        "fallback_attempt_limit_proven": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--t3-db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    connection = readonly(args.db)
    t3 = readonly(args.t3_db)
    try:
        probes = [receipt(args.scratch / name) for name in PROBES]
        native_rows = {sid: native(connection, t3, sid) for sid in
                       sorted({probe["session_id"] for probe in probes if probe["session_id"]} | {CRON_ID})}
        for probe in probes:
            sid = probe["session_id"]
            if sid:
                session = native_rows[sid]["session"]
                probe["input_output_tokens_match_native"] = all(
                    probe["tokens"][direction] == session[direction + "_tokens"]
                    for direction in ("input", "output")
                )
        output = {
            "scope": "Only VERDICT.json's five receipt files and five native sessions. No new model requests.",
            "sources": {"hermes_db": str(args.db), "t3_db": str(args.t3_db)},
            "sql": {"session": SESSION_SQL, "usage": USAGE_SQL, "messages": MESSAGE_SQL, "t3": T3_SQL},
            "read_only": {"uri_mode": "ro", "query_only": True, "transaction": "BEGIN then ROLLBACK"},
            "probes": probes,
            "native": native_rows,
            "acceptance_met": False,
            "acceptance_limit": "These receipts do not prove installed affected app, intended account, or bounded fallback. No new affected-lane turn was authorized or sent.",
        }
        args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
        print(f"Collected {len(probes)} files and {len(native_rows)} native sessions into {args.output}")
        for probe in probes:
            print(f"{Path(probe['path']).name}: result_exit={probe['exit_code']}, session={probe['session_id'] or 'none'}")
        for sid, row in native_rows.items():
            print(f"{sid}: {row['session']['model']}, provider={row['session']['billing_provider']}, tools={row['session']['tool_call_count']}, T3 session/native-ref matches={len(row['t3_thread_matches'])}")
        print("acceptance_met=false; exit 0 means collection succeeded, not route qualification")
    finally:
        connection.rollback()
        connection.close()
        t3.rollback()
        t3.close()


if __name__ == "__main__":
    main()
