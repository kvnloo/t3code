#!/usr/bin/env bash
# PoH P2/04 runner: waits for >= 3 GB available (sleep 60, max 60 min), then runs one bench arm
# under the shared heavy lock. usage: p04-run.sh <out dir> <seed> [bench args...]
set -uo pipefail
WT=/mnt/zer0models/workspace/zer0/oss/t3code-wt/poh-04
LOCK=/home/kvn/.hermes/profiles/clean/cache/scratch/heavy.lock
PICKS=/mnt/zer0models/workspace/zer0/data/operations/t3code-factory/poh/raw/00-baseline-9bcf7533-run1/run.json
out=$1 seed=$2; shift 2
cd "$WT"
avail() { free -g | awk '/^Mem:/ {print $7}'; }
wait_mem() {
  for _ in $(seq 1 60); do
    [ "$(avail)" -ge 3 ] && return 0
    echo "[$(date -Is)] waiting for memory: $(avail) GB available"; sleep 60
  done
}
# The host's pressure-relief guard TERMs bench servers (disposable class) under memory pressure;
# such a run is incomplete, so it is retried from scratch (at most 8 attempts).
for attempt in 1 2 3 4 5 6 7 8; do
  wait_mem
  rm -rf "$out"
  echo "[$(date -Is)] start $(basename "$out") attempt $attempt (avail $(avail) GB)"
  flock "$LOCK" timeout 1500 node bench/poh/bench.ts --seed "$seed" --picks-from "$PICKS" \
    --iotap .t3/bench/p04/iotap.so "$@" --out "$out" > "$out.log" 2>&1
  code=$?
  echo "[$(date -Is)] end $(basename "$out") attempt $attempt exit=$code"
  [ $code -eq 0 ] && exit 0
  cp "$out.log" "$out.attempt$attempt.log"
  sleep 30
done
exit $code
