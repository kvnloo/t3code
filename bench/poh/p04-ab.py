#!/usr/bin/env python3
"""Pool the PoH 04 interleaved A/B (bench/poh/p04-ab.sh dirs ab-<sha>-<slot>-<arm>).

Per tapped turn: SQLite bytes (WAL + main db + journal writes), WAL commits, WAL frames, live
client latency (time to first event / first assistant delta, lag, delta cadence), peak RSS and
CPU. Per measured boot: reconnect-replay wire bytes. Prints a markdown table of p50/p95 per arm,
the median shift against `off` with a bootstrap 95% CI, and optionally writes JSON.

usage: p04-ab.py <raw dir> <sha8>[,<sha8>...] [--json out.json]

Several comma-separated SHAs pool runs from those SHAs (only when the bench code is unchanged
between them); a slot is counted per (sha, slot).
"""
import glob, json, os, random, re, statistics, sys

raw, sha = sys.argv[1], sys.argv[2]
json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
ARMS = ["off", "w25", "idx", "w150"]

turns = {a: [] for a in ARMS}
boots = {a: [] for a in ARMS}
slots = {a: set() for a in ARMS}
dirs = sorted(d for s in sha.split(",") for d in glob.glob(os.path.join(raw, f"ab-{s}-*-*/")))
for d in dirs:
    m = re.search(r"ab-([0-9a-f]{8})-(\d+)-(\w+)/$", d)
    if not m or m.group(3) not in ARMS or not os.path.exists(os.path.join(d, "run.json")):
        continue
    slot, arm = (m.group(1), int(m.group(2))), m.group(3)
    slots[arm].add(slot)
    for line in open(os.path.join(d, "samples.ndjson")):
        s = json.loads(line)
        if s.get("kind") == "turn" and "io" in s:
            io, live = s["io"], s.get("live") or {}
            turns[arm].append(
                {
                    "sqliteBytes": io["walBytes"] + io["dbBytes"] + io["journalBytes"],
                    "walBytes": io["walBytes"],
                    "commits": io["walCommits"],
                    "frames": io["walFrames"],
                    "turnMs": s["ms"],
                    "firstEventMs": live.get("firstEventMs"),
                    "firstAssistantMs": live.get("firstAssistantMs"),
                    "lagP50Ms": live.get("lagP50Ms"),
                    "lagP95Ms": live.get("lagP95Ms"),
                    "frameGapP50Ms": live.get("frameGapP50Ms"),
                    "assistantGapP50Ms": live.get("assistantGapP50Ms"),
                    "liveFrames": live.get("frames"),
                    "peakRssMiB": s["peakRss"] / 2**20,
                    "cpuS": s["cpuS"],
                }
            )
        elif s.get("kind") == "reconnect-missed-turn" and s.get("boot", 0) >= 1:
            boots[arm].append({"replayWsBytes": s["wsBytes"], "replayHttpBytes": s["httpBytes"]})


def q(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def boot_ci(a, b, iters=4000):
    a = [x for x in a if x is not None]
    b = [x for x in b if x is not None]
    if not a or not b:
        return None
    rng = random.Random(4)
    diffs = sorted(
        statistics.median(rng.choices(b, k=len(b))) - statistics.median(rng.choices(a, k=len(a)))
        for _ in range(iters)
    )
    return diffs[int(iters * 0.025)], diffs[int(iters * 0.975)]


METRICS = [
    ("sqliteBytes", "SQLite bytes/turn", 1 / 2**20, "MiB"),
    ("commits", "commits/turn", 1, ""),
    ("frames", "WAL frames/turn", 1, ""),
    ("firstEventMs", "first live event", 1, "ms"),
    ("firstAssistantMs", "first assistant delta", 1, "ms"),
    ("lagP50Ms", "event lag p50", 1, "ms"),
    ("lagP95Ms", "event lag p95", 1, "ms"),
    ("frameGapP50Ms", "frame gap p50", 1, "ms"),
    ("assistantGapP50Ms", "assistant delta gap p50", 1, "ms"),
    ("liveFrames", "live frames/turn", 1, ""),
    ("turnMs", "turn wall", 1, "ms"),
    ("peakRssMiB", "peak RSS", 1, "MiB"),
    ("cpuS", "server CPU/turn", 1, "s"),
]

result = {"sha": sha, "arms": {}}
print(f"slots per arm: " + ", ".join(f"{a}={len(slots[a])}" for a in ARMS))
print(f"tapped turns per arm: " + ", ".join(f"{a}={len(turns[a])}" for a in ARMS))
print()
print("| metric | " + " | ".join(f"{a} p50 / p95" for a in ARMS) + " | " + " | ".join(f"Δp50 {a} vs off [95% CI]" for a in ARMS[1:]) + " |")
print("|---" * (1 + 2 * len(ARMS) - 1) + "|")
rows = METRICS + [("replayWsBytes", "reconnect replay ws bytes", 1 / 1024, "KiB")]
for key, label, scale, unit in rows:
    src = boots if key == "replayWsBytes" else turns
    cells, deltas = [], []
    for a in ARMS:
        xs = [r[key] for r in src[a]]
        p50, p95 = q(xs, 0.5), q(xs, 0.95)
        result["arms"].setdefault(a, {})[key] = {"n": len([x for x in xs if x is not None]), "p50": p50, "p95": p95}
        cells.append("n/a" if p50 is None else f"{p50 * scale:.3g} / {p95 * scale:.3g}")
    off = [r[key] for r in src["off"]]
    for a in ARMS[1:]:
        xs = [r[key] for r in src[a]]
        ci = boot_ci(off, xs)
        p50a, p50o = q(xs, 0.5), q(off, 0.5)
        if ci is None or p50a is None or p50o is None:
            deltas.append("n/a")
            continue
        d = (p50a - p50o) * scale
        result["arms"][a][key]["deltaVsOff"] = {"p50": p50a - p50o, "ci95": ci}
        deltas.append(f"{d:+.3g} [{ci[0] * scale:+.3g}, {ci[1] * scale:+.3g}]")
    print(f"| {label}{' (' + unit + ')' if unit else ''} | " + " | ".join(cells) + " | " + " | ".join(deltas) + " |")

if json_out:
    json.dump(result, open(json_out, "w"), indent=2)
