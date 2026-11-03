#!/usr/bin/env python3
"""P2/03b one-time conversion cost: run `t3 doctor --fix` on a copy of a seed and sample it.

Usage: conv.py <seed.sqlite> <work dir> <out.json> [PAGE_SIZE|unset]
Records wall time, peak RSS (VmHWM), peak disk (userdata + SQLite temp dir), storage writes
(/proc write_bytes) and, through the iotap, write syscalls to the DB, rollback journal and WAL.
The doctor holds the database exclusively for its whole run (the server must be stopped), so the
wall time is the writer hold. Run under flock heavy.lock.
"""
import json, os, shutil, struct, subprocess, sys, time

seed, work, out = sys.argv[1], sys.argv[2], sys.argv[3]
size = sys.argv[4] if len(sys.argv) > 4 else "unset"
wt = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
wt = os.environ.get("POH_WT", wt)
shutil.rmtree(work, ignore_errors=True)
home = os.path.join(work, "home")
userdata = os.path.join(home, "userdata")
tmp = os.path.join(work, "tmp")
tap = os.path.join(work, "tap")
for d in (userdata, tmp, tap):
    os.makedirs(d)
shutil.copyfile(seed, os.path.join(userdata, "statev2.sqlite"))
# A live install is in WAL mode; VACUUM INTO seeds are not. POH_CONV_WAL=1 converts the copy first.
start_mode = "delete"
if os.environ.get("POH_CONV_WAL") == "1":
    start_mode = subprocess.run(["sqlite3", os.path.join(userdata, "statev2.sqlite"), "PRAGMA journal_mode=WAL"],
                                capture_output=True, text=True, check=True).stdout.strip()

def tree_bytes(*roots):
    total = 0
    for root in roots:
        for dirpath, _, files in os.walk(root):
            for f in files:
                try:
                    total += os.lstat(os.path.join(dirpath, f)).st_blocks * 512
                except FileNotFoundError:
                    pass
    return total

def deleted_open_bytes(pid):
    # SQLite unlinks its VACUUM temp database right after opening it, so a directory walk misses it.
    total = 0
    try:
        fds = os.listdir(f"/proc/{pid}/fd")
    except FileNotFoundError:
        return 0
    for fd in fds:
        try:
            if os.readlink(f"/proc/{pid}/fd/{fd}").endswith(" (deleted)"):
                total += os.stat(f"/proc/{pid}/fd/{fd}").st_blocks * 512
        except (FileNotFoundError, PermissionError):
            pass
    return total

env = {
    "HOME": os.environ["HOME"], "PATH": os.environ["PATH"], "TMPDIR": tmp, "SQLITE_TMPDIR": tmp,
    "T3CODE_TELEMETRY_ENABLED": "false", "LD_PRELOAD": os.path.join(wt, ".t3/bench/p03b/iotap.so"),
    "POH_IOTAP_DIR": tap,
}
if size != "unset":
    env["T3CODE_EXPERIMENTAL_PAGE_SIZE"] = size
disk0 = tree_bytes(userdata, tmp)
t0 = time.monotonic()
p = subprocess.Popen(["node", "apps/server/src/bin.ts", "doctor", "--fix", "--base-dir", home],
                     cwd=wt, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
peak_rss = peak_disk = write_bytes = 0
while p.poll() is None:
    try:
        with open(f"/proc/{p.pid}/status") as f:
            for line in f:
                if line.startswith("VmHWM:"):
                    peak_rss = max(peak_rss, int(line.split()[1]) * 1024)
        with open(f"/proc/{p.pid}/io") as f:
            for line in f:
                if line.startswith("write_bytes:"):
                    write_bytes = max(write_bytes, int(line.split()[1]))
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        pass
    peak_disk = max(peak_disk, tree_bytes(userdata, tmp) + deleted_open_bytes(p.pid))
    time.sleep(0.1)
wall = time.monotonic() - t0
log = p.stdout.read().decode()
names = ["walBytes", "walWrites", "walFrames", "walCommits", "walHeaders", "dbBytes", "dbWrites",
         "shmBytes", "otherBytes", "walSyncs", "dbSyncs", "journalBytes"]
syscalls = {}
for f in os.listdir(tap):
    vals = struct.unpack("<16Q", open(os.path.join(tap, f), "rb").read())
    for n, v in zip(names, vals):
        syscalls[n] = syscalls.get(n, 0) + v
db = os.path.join(userdata, "statev2.sqlite")
page = subprocess.run(["sqlite3", "-readonly", db, "PRAGMA page_size"], capture_output=True, text=True).stdout.strip()
result = {
    "seed": seed, "startJournalMode": start_mode, "pageSizeFlag": size, "exit": p.returncode, "wallS": round(wall, 2),
    "peakRssBytes": peak_rss, "diskBeforeBytes": disk0, "peakDiskBytes": peak_disk,
    "peakExtraDiskBytes": peak_disk - disk0, "afterDbBytes": os.path.getsize(db),
    "afterPageSize": int(page or 0), "writeBytesLowerBound": write_bytes, "syscalls": syscalls,
    "log": log,
}
json.dump(result, open(out, "w"), indent=1)
print(json.dumps({k: v for k, v in result.items() if k != "log"}))
