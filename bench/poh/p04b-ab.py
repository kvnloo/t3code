#!/usr/bin/env python3
"""Pool the PoH 04b 2x2 A/B (bench/poh/p04b-ab.sh dirs <job>-<slot>-<base>-<window>).

Same per-turn metrics as p04-ab.py, plus SQLite bytes per commit. Prints p50/p95 per arm and the
median shifts with bootstrap 95% CIs:
  w25 on PRE      pre-w25  vs pre-off
  w25 on POST     post-w25 vs post-off
  pruning (off)   post-off vs pre-off
  pruning (w25)   post-w25 vs pre-w25
  w25 DiD         (post-w25 - post-off) - (pre-w25 - pre-off): does the window save as much on POST?

usage: p04b-ab.py <raw dir>[,<raw dir>...] [--json out.json]
A slot is counted per (job, slot).
"""
import glob, json, os, random, re, statistics, sys

raws = sys.argv[1].split(",")
json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
ARMS = ["pre-off", "pre-w25", "post-off", "post-w25"]
COMPARISONS = [
    ("w25 on PRE", "pre-w25", "pre-off"),
    ("w25 on POST", "post-w25", "post-off"),
    ("pruning, off", "post-off", "pre-off"),
    ("pruning, w25", "post-w25", "pre-w25"),
]

turns = {a: [] for a in ARMS}
boots = {a: [] for a in ARMS}
slots = {a: set() for a in ARMS}
shas = {a: set() for a in ARMS}
for d in sorted(d for raw in raws for d in glob.glob(os.path.join(raw, "*-*-*-*/"))):
    m = re.search(r"([\w.]+)-(\d+)-(pre|post)-(off|w25)/$", d)
    if not m or not os.path.exists(os.path.join(d, "run.json")):
        continue
    arm = f"{m.group(3)}-{m.group(4)}"
    slots[arm].add((m.group(1), int(m.group(2))))
    shas[arm].add(json.load(open(os.path.join(d, "run.json")))["sha"][:10])
    for line in open(os.path.join(d, "samples.ndjson")):
        s = json.loads(line)
        if s.get("kind") == "turn" and "io" in s:
            io, live = s["io"], s.get("live") or {}
            sqlite_bytes = io["walBytes"] + io["dbBytes"] + io["journalBytes"]
            turns[arm].append(
                {
                    "sqliteBytes": sqlite_bytes,
                    "commits": io["walCommits"],
                    "bytesPerCommit": sqlite_bytes / io["walCommits"] if io["walCommits"] else None,
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
            boots[arm].append({"replayWsBytes": s["wsBytes"]})


def q(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def clean(xs):
    return [x for x in xs if x is not None]


def boot_ci(stat, groups, iters=4000):
    """Bootstrap 95% CI of stat(medians of resampled groups)."""
    if any(not g for g in groups):
        return None
    rng = random.Random(4)
    values = sorted(
        stat(*[statistics.median(rng.choices(g, k=len(g))) for g in groups]) for _ in range(iters)
    )
    return values[int(iters * 0.025)], values[int(iters * 0.975)]


METRICS = [
    ("sqliteBytes", "SQLite MiB/turn", 1 / 2**20),
    ("commits", "commits/turn", 1),
    ("bytesPerCommit", "SQLite KiB/commit", 1 / 1024),
    ("frames", "WAL frames/turn", 1),
    ("firstEventMs", "first live event (ms)", 1),
    ("firstAssistantMs", "first assistant delta (ms)", 1),
    ("lagP50Ms", "event lag p50 (ms)", 1),
    ("lagP95Ms", "event lag p95 (ms)", 1),
    ("frameGapP50Ms", "WS frame gap p50 (ms)", 1),
    ("assistantGapP50Ms", "assistant delta gap p50 (ms)", 1),
    ("liveFrames", "live frames/turn", 1),
    ("turnMs", "turn wall (ms)", 1),
    ("peakRssMiB", "peak RSS (MiB)", 1),
    ("cpuS", "server CPU/turn (s)", 1),
    ("replayWsBytes", "reconnect replay wire (KiB)", 1 / 1024),
]


def fmt(x, scale):
    return "n/a" if x is None else f"{x * scale:.3g}"


def fmt_delta(d, ci, scale):
    if d is None or ci is None:
        return "n/a"
    return f"{d * scale:+.3g} [{ci[0] * scale:+.3g}, {ci[1] * scale:+.3g}]"


result = {
    "slots": {a: len(slots[a]) for a in ARMS},
    "turns": {a: len(turns[a]) for a in ARMS},
    "shas": {a: sorted(shas[a]) for a in ARMS},
    "arms": {a: {} for a in ARMS},
    "comparisons": {},
}
print("slots per arm: " + ", ".join(f"{a}={len(slots[a])}" for a in ARMS))
print("tapped turns per arm: " + ", ".join(f"{a}={len(turns[a])}" for a in ARMS))
print("shas: " + ", ".join(f"{a}={'/'.join(sorted(shas[a]))}" for a in ARMS))
print()
labels = [c[0] for c in COMPARISONS] + ["w25 DiD (POST - PRE)"]
print("| metric | " + " | ".join(ARMS) + " | " + " | ".join(f"Δ {label}" for label in labels) + " |")
print("|---" * (1 + len(ARMS) + len(labels)) + "|")
for key, label, scale in METRICS:
    src = boots if key == "replayWsBytes" else turns
    xs = {a: clean([r[key] for r in src[a]]) for a in ARMS}
    cells, deltas = [], []
    for a in ARMS:
        p50, p95 = q(xs[a], 0.5), q(xs[a], 0.95)
        result["arms"][a][key] = {"n": len(xs[a]), "p50": p50, "p95": p95}
        cells.append(f"{fmt(p50, scale)} / {fmt(p95, scale)}")
    for name, arm, ref in COMPARISONS:
        d = None if not xs[arm] or not xs[ref] else q(xs[arm], 0.5) - q(xs[ref], 0.5)
        ci = boot_ci(lambda a, b: a - b, [xs[arm], xs[ref]])
        result["comparisons"].setdefault(name, {})[key] = {"p50": d, "ci95": ci, "arm": arm, "ref": ref}
        deltas.append(fmt_delta(d, ci, scale))
    groups = [xs["post-w25"], xs["post-off"], xs["pre-w25"], xs["pre-off"]]
    did = lambda pw, po, rw, ro: (pw - po) - (rw - ro)
    d = None if any(not g for g in groups) else did(*[q(g, 0.5) for g in groups])
    ci = boot_ci(did, groups)
    result["comparisons"].setdefault("w25 DiD", {})[key] = {"p50": d, "ci95": ci}
    deltas.append(fmt_delta(d, ci, scale))
    print(f"| {label} | " + " | ".join(cells) + " | " + " | ".join(deltas) + " |")

if json_out:
    json.dump(result, open(json_out, "w"), indent=2)
