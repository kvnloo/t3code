#!/usr/bin/env python3
"""Pool the PoH 04c real-turn A/B (bench/poh/p04c-ab.sh dirs <provider>-<shape>-<slot>-<off|w25>).

A unit is what the tap measures as one window: one turn in s1, one batch of 4 dispatched-together
turns in s4. Unit metrics are reported per turn (unit total / threads) and per stored event
(unit total / events stored), because real turns vary in length. Live metrics (lag, first event,
first assistant delta, frame gap, turn wall) are per turn. Units with a failed or non-completed
turn are excluded and counted. Prints p50/p95 per arm and the w25 - off median shift with a
4000-iteration bootstrap 95% CI, per provider x shape.

usage: p04c-ab.py <raw dir>[,<raw dir>...] [--json out.json]
"""
import glob, json, os, random, re, statistics, sys

raws = sys.argv[1].split(",")
json_out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None

units, turns, slots, excluded, shas, cli = {}, {}, {}, {}, {}, {}
for d in sorted(d for raw in raws for d in glob.glob(os.path.join(raw, "*-s[14]-*-*/"))):
    m = re.search(r"([\w.]+)-(s1|s4)-(\d+)-(off|w25)/$", d)
    if not m or not os.path.exists(os.path.join(d, "run.json")):
        continue
    key = (m.group(1), m.group(2), m.group(4))
    run = json.load(open(os.path.join(d, "run.json")))
    shas.setdefault(key, set()).add(run["sha"][:10])
    cli.setdefault(m.group(1), set()).add(
        json.dumps({"cli": run.get("cli"), "model": run.get("model"), "options": run.get("options"),
                    "providerVersion": (run.get("provider") or {}).get("version")}, sort_keys=True))
    slots.setdefault(key, set()).add(int(m.group(3)))
    for line in open(os.path.join(d, "samples.ndjson")):
        s = json.loads(line)
        if s.get("kind") != "unit" or s.get("io") is None:
            continue
        if s["failures"] or any(t["status"] != "completed" for t in s["turns"]):
            excluded.setdefault(key, []).append(
                {"dir": os.path.basename(d.rstrip("/")), "unit": s["unit"],
                 "statuses": [t["status"] for t in s["turns"]], "failures": s["failures"]})
            continue
        io, n, events = s["io"], s["threads"], s["events"]
        sqlite_bytes = io["walBytes"] + io["dbBytes"] + io["journalBytes"]
        units.setdefault(key, []).append({
            "sqliteBytes": sqlite_bytes / n,
            "commits": io["walCommits"] / n,
            "frames": io["walFrames"] / n,
            "events": events / n,
            "commitsPerEvent": io["walCommits"] / events if events else None,
            "bytesPerEvent": sqlite_bytes / events if events else None,
            "bytesPerCommit": sqlite_bytes / io["walCommits"] if io["walCommits"] else None,
            "cpuS": s["cpuS"] / n,
            "peakRssMiB": s["peakRss"] / 2**20,
            "unitWallMs": s["wallMs"],
        })
        for t in s["turns"]:
            live = t["live"]
            turns.setdefault(key, []).append({
                "turnMs": t["wallMs"],
                "eventsStoredThread": t["eventsStored"],
                "liveEvents": live.get("events"),
                "liveFrames": live.get("frames"),
                "firstEventMs": live.get("firstEventMs"),
                "firstAssistantMs": live.get("firstAssistantMs"),
                "lagP50Ms": live.get("lagP50Ms"),
                "lagP95Ms": live.get("lagP95Ms"),
                "frameGapP50Ms": live.get("frameGapP50Ms"),
                "assistantGapP50Ms": live.get("assistantGapP50Ms"),
            })


def q(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def boot_ci(a, b, iters=4000):
    """Bootstrap 95% CI of median(a) - median(b)."""
    if not a or not b:
        return None
    rng = random.Random(4)
    diffs = sorted(
        statistics.median(rng.choices(a, k=len(a))) - statistics.median(rng.choices(b, k=len(b)))
        for _ in range(iters)
    )
    return diffs[int(iters * 0.025)], diffs[int(iters * 0.975)]


UNIT_METRICS = [
    ("sqliteBytes", "SQLite MiB/turn", 1 / 2**20),
    ("commits", "commits/turn", 1),
    ("frames", "WAL frames/turn", 1),
    ("events", "events stored/turn", 1),
    ("commitsPerEvent", "commits/event", 1),
    ("bytesPerEvent", "SQLite KiB/event", 1 / 1024),
    ("bytesPerCommit", "SQLite KiB/commit", 1 / 1024),
    ("cpuS", "server CPU/turn (s)", 1),
    ("peakRssMiB", "peak RSS (MiB)", 1),
]
TURN_METRICS = [
    ("eventsStoredThread", "events stored/thread", 1),
    ("liveEvents", "live events/turn", 1),
    ("lagP50Ms", "event lag p50 (ms)", 1),
    ("lagP95Ms", "event lag p95 (ms)", 1),
    ("firstEventMs", "first live event (ms)", 1),
    ("firstAssistantMs", "first assistant delta (ms)", 1),
    ("frameGapP50Ms", "WS frame gap p50 (ms)", 1),
    ("liveFrames", "live frames/turn", 1),
    ("turnMs", "turn wall (s)", 1 / 1000),
]


def fmt(x, scale):
    return "n/a" if x is None else f"{x * scale:.3g}"


def fmt_delta(d, ci, scale):
    if d is None or ci is None:
        return "n/a"
    return f"{d * scale:+.3g} [{ci[0] * scale:+.3g}, {ci[1] * scale:+.3g}]"


result = {"groups": {}, "excluded": {f"{k[0]}-{k[1]}-{k[2]}": v for k, v in excluded.items()},
          "cli": {k: [json.loads(x) for x in sorted(v)] for k, v in cli.items()}}
groups = sorted({(k[0], k[1]) for k in list(units) + list(excluded)})
for provider, shape in groups:
    off, w25 = (provider, shape, "off"), (provider, shape, "w25")
    g = result["groups"][f"{provider}-{shape}"] = {
        "slots": {a: sorted(slots.get((provider, shape, a), [])) for a in ("off", "w25")},
        "units": {a: len(units.get((provider, shape, a), [])) for a in ("off", "w25")},
        "turns": {a: len(turns.get((provider, shape, a), [])) for a in ("off", "w25")},
        "excludedUnits": {a: len(excluded.get((provider, shape, a), [])) for a in ("off", "w25")},
        "shas": sorted(set().union(*[shas.get(k, set()) for k in (off, w25)])),
        "metrics": {},
    }
    print(f"### {provider} {shape}")
    print(f"slots off={g['slots']['off']} w25={g['slots']['w25']}; units off={g['units']['off']} "
          f"w25={g['units']['w25']}; turns off={g['turns']['off']} w25={g['turns']['w25']}; "
          f"excluded units off={g['excludedUnits']['off']} w25={g['excludedUnits']['w25']}; sha {'/'.join(g['shas'])}")
    print()
    print("| metric | off p50 / p95 | w25 p50 / p95 | Δ p50 w25 − off [95% CI] | Δ % |")
    print("|---|---|---|---|---|")
    for src, metrics in ((units, UNIT_METRICS), (turns, TURN_METRICS)):
        for key, label, scale in metrics:
            a = [r[key] for r in src.get(w25, []) if r[key] is not None]
            b = [r[key] for r in src.get(off, []) if r[key] is not None]
            pa, pb = q(a, 0.5), q(b, 0.5)
            d = None if pa is None or pb is None else pa - pb
            ci = boot_ci(a, b)
            pct = None if d is None or not pb else 100 * d / pb
            g["metrics"][key] = {"label": label, "off": {"n": len(b), "p50": pb, "p95": q(b, 0.95)},
                                 "w25": {"n": len(a), "p50": pa, "p95": q(a, 0.95)},
                                 "deltaP50": d, "ci95": ci, "deltaPct": pct}
            print(f"| {label} | {fmt(pb, scale)} / {fmt(q(b, 0.95), scale)} | {fmt(pa, scale)} / "
                  f"{fmt(q(a, 0.95), scale)} | {fmt_delta(d, ci, scale)} | "
                  f"{'n/a' if pct is None else f'{pct:+.0f}%'} |")
    print()

if json_out:
    json.dump(result, open(json_out, "w"), indent=2)
