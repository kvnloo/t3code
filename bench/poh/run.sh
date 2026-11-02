#!/usr/bin/env bash
# PoH P1 baseline: runs the bench under the shared heavy lock and writes the report.
# Usage: bench/poh/run.sh [--runs 10] [--warm 10] [--turns 1] [--out DIR] [--seed PATH]
#        RESULTS_MD=... LEDGER=... to also write the markdown report and ledger rows.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
lock="${HEAVY_LOCK:-/home/kvn/.hermes/profiles/clean/cache/scratch/heavy.lock}"
seed="$root/.t3/userdata/statev2.sqlite"
if [[ ! -f "$seed" ]]; then
  echo "missing seed $seed: seed it with VACUUM INTO (see bench/poh/README.md)" >&2
  exit 2
fi
out=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[$i]}" == "--out" ]] && out="${args[$((i + 1))]}"
done
if [[ -z "$out" ]]; then
  out="$root/.t3/bench/results/$(date -u +%Y%m%dT%H%M%SZ)"
  args+=(--out "$out")
fi
free -g
cd "$root"
flock "$lock" node bench/poh/bench.ts "${args[@]}"
node bench/poh/report.ts --in "$out" ${RESULTS_MD:+--md "$RESULTS_MD"} ${LEDGER:+--ledger "$LEDGER"}
