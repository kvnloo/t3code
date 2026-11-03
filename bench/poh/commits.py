#!/usr/bin/env python3
"""Attribute a bench run's SQLite commits to the code that issued them (PoH P2/04).

Reads the kept bench home's server trace (`server.trace.ndjson*`) and counts, inside each
simulated-turn window from samples.ndjson, every top-level `sql.transaction` span (one COMMIT
or ROLLBACK) plus every write statement that ran outside a transaction (autocommit). Each is
grouped by the nearest enclosing non-SQL span and by that span's ancestor chain.

usage: commits.py <bench out dir> <kept bench home> [--json out.json]
"""
import collections, glob, json, os, re, sys

out_dir, home = sys.argv[1], sys.argv[2]
json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None

samples = [json.loads(l) for l in open(os.path.join(out_dir, "samples.ndjson"))]
turns = [s for s in samples if s.get("kind") == "turn" and "startedAtMs" in s]

spans = {}
for path in sorted(glob.glob(os.path.join(home, "**", "server.trace.ndjson*"), recursive=True)):
    for line in open(path, errors="replace"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("type", "span") != "span" and "spanId" not in r:
            continue
        if "spanId" in r and "name" in r:
            spans[r["spanId"]] = r

WRITE = re.compile(r"^\s*(INSERT|UPDATE|DELETE|REPLACE)\b", re.I)


def is_sql(s):
    return s["name"] == "sqlite" or s["name"].startswith("sql.")


def ancestors(s):
    chain = []
    seen = set()
    while s is not None and s["spanId"] not in seen:
        seen.add(s["spanId"])
        chain.append(s)
        s = spans.get(s.get("parentSpanId"))
    return chain


def statement_text(s):
    a = s.get("attributes", {})
    return a.get("db.query.text") or a.get("db.statement") or ""


def start_ms(s):
    return int(s["startTimeUnixNano"]) / 1e6


def classify(s):
    chain = ancestors(s)[1:]
    if s["name"] == "sql.transaction":
        if any(c["name"] == "sql.transaction" for c in chain):
            return None  # savepoint inside an outer transaction
        if s.get("attributes", {}).get("db.connection") not in (None, "writer"):
            return None  # reader snapshot, no commit
        kind = "transaction"
    else:
        if any(c["name"] == "sql.transaction" for c in chain):
            return None
        if not WRITE.match(statement_text(s)):
            return None
        kind = "autocommit"
    owner = next((c["name"] for c in chain if not is_sql(c)), "<root>")
    path = " < ".join(c["name"] for c in chain if not is_sql(c))[:400]
    return kind, owner, path


windows = [(t["startedAtMs"], t["startedAtMs"] + t["ms"], t) for t in turns]
per_turn = []
for lo, hi, t in windows:
    counts = collections.Counter()
    paths = collections.Counter()
    total = 0
    for s in spans.values():
        if not (s["name"] == "sql.transaction" or is_sql(s)):
            continue
        if not lo <= start_ms(s) <= hi:
            continue
        c = classify(s)
        if c is None:
            continue
        kind, owner, path = c
        counts[(kind, owner)] += 1
        paths[path] += 1
        total += 1
    per_turn.append({"boot": t.get("boot"), "turn": t.get("turn"), "ms": t["ms"], "commits": total,
                     "byOwner": {f"{k} {o}": n for (k, o), n in counts.most_common()},
                     "byPath": dict(paths.most_common())})

for p in per_turn:
    print(f"boot {p['boot']} turn {p['turn']}: {p['commits']} commits in {p['ms']:.0f} ms")
agg = collections.Counter()
for p in per_turn:
    agg.update(p["byOwner"])
n = max(1, len(per_turn))
print("\nmean commits per turn by owner span:")
for k, v in agg.most_common():
    print(f"  {v / n:6.1f}  {k}")
aggp = collections.Counter()
for p in per_turn:
    aggp.update(p["byPath"])
print("\nmean commits per turn by span path:")
for k, v in aggp.most_common(40):
    print(f"  {v / n:6.1f}  {k}")
if json_out:
    json.dump(per_turn, open(json_out, "w"), indent=1)
