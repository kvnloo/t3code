#!/usr/bin/env python3
"""Estimate how many SQLite commits a short group-commit window would save on a T3 Code database.

Read-only. Replays the last N hours of orchestration_events in sequence order, using the
ingestion timestamps (occurred_at), and counts commits under a window rule: plain node,
message, turn-item and plan updates wait up to W ms and commit together; any other event
commits the queue first and then itself. Today's baseline is one commit per event.

usage: python3 commit_window_estimate.py [path to statev2.sqlite] [hours]
"""
import datetime, os, sqlite3, sys

path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.t3/userdata/statev2.sqlite")
hours = float(sys.argv[2]) if len(sys.argv) > 2 else 2
db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
rows = db.execute(
    "select sequence, occurred_at, event_type from orchestration_events "
    "where occurred_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) order by sequence",
    (f"-{hours} hours",),
).fetchall()
if len(rows) < 2:
    sys.exit("not enough recent events")
DEFERRABLE = {"node.updated", "message.updated", "turn-item.updated", "plan.updated"}
ts = [datetime.datetime.fromisoformat(o.replace("Z", "+00:00")).timestamp() for _, o, _ in rows]
gaps = rows[-1][0] - rows[0][0] + 1 - len(rows)
print(f"{len(rows)} events in the last {hours} h; {gaps} sequence gaps (rows compaction already deleted)")
for w_ms in (10, 25, 50):
    w, commits, start = w_ms / 1000, 0, None
    for (_, _, kind), t in zip(rows, ts):
        if start is not None and t - start > w:
            commits, start = commits + 1, None
        if kind in DEFERRABLE:
            start = t if start is None else start
        else:
            commits += 1 + (start is not None)
            start = None
    commits += start is not None
    print(f"  {w_ms:>3} ms window: {commits} commits instead of {len(rows)} ({100 * (1 - commits / len(rows)):.1f}% fewer)")
