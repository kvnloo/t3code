#!/usr/bin/env python3
"""Check the collected historical R07 evidence, not live route acceptance."""
import hashlib
import json
from pathlib import Path
import sys


def main():
    path = Path(sys.argv[1])
    evidence = json.loads(path.read_text())
    probes = evidence["probes"]
    native = evidence["native"]
    assert len(probes) == 5 and len(native) == 5
    for probe in probes:
        assert hashlib.sha256(Path(probe["path"]).read_bytes()).hexdigest() == probe["sha256"]
        assert probe["last_event_type"] == "result"
        if probe["session_id"]:
            assert probe["input_output_tokens_match_native"]
    assert all(row["chat_task_usage_totals_match_session"] for row in native.values())
    print("PASS: five source hashes and final events; four transcript/native token joins; five chat-task usage joins")
    for probe in probes:
        name = Path(probe["path"]).name
        if name.startswith("directsdk"):
            session = native[probe["session_id"]]["session"]
            assert probe["exit_code"] == 0
            assert session["model"] == "vllm-sr/paid"
            assert session["billing_provider"] == "custom:vllm-sr"
            assert session["tool_call_count"] == 0
            assert native[probe["session_id"]]["last_message_is_assistant_stop"]
        elif name == "opus-sub2-route-probe.jsonl":
            assert probe["exit_code"] == 2 and not probe["session_id"]
            assert "--run-budget" in probe["error"]
        else:
            assert probe["exit_code"] == 1 and "HTTP 429" in probe["error"]
            assert native[probe["session_id"]]["model_usage"] == []
    print("PASS: two custom-route successes without tools; two explicit HTTP 429 failures; one pre-session CLI rejection")
    cron = [row for row in native.values() if row["session"]["source"] == "cron"]
    assert len(cron) == 1
    row = cron[0]
    assert row["session"]["model"] == "claude-opus-5-5"
    assert row["session"]["billing_provider"] == "anthropic"
    assert row["session"]["tool_call_count"] == 1
    assert row["tool_calls_have_responses"] and row["last_message_is_assistant_stop"]
    assert row["session"]["end_reason"] == "cron_complete"
    print("PASS: cron Opus turn has paired terminal response, assistant stop, and cron_complete")
    assert all(not row["t3_thread_matches"] for row in native.values())
    assert evidence["acceptance_met"] is False
    print("PASS: no scoped T3 session/native-ref matches; missing account/device/fallback acceptance remains explicit")
    if len(sys.argv) == 3:
        assert evidence == json.loads(Path(sys.argv[2]).read_text())
        print("PASS: second read-only collection exactly matches the first")


if __name__ == "__main__":
    main()
