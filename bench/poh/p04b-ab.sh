#!/usr/bin/env bash
# PoH 04b: the 2x2 commit-window A/B across #29806 (PRE = its first parent, POST = it), each base
# with the window off and at 25 ms. Same bench args as P2/04 (ab-ext.sh): one measured boot x 2
# tapped turns, --skip-opens. Each slot runs all four arms back to back on this runner, in the
# order A B C D on even slots and D C B A on odd ones, so drift hits every arm alike.
# Resumable: an arm whose run.json exists is skipped. A failed arm is retried once.
#
# usage: p04b-ab.sh <pre checkout> <post checkout> <seed dir> <out dir> <job label> <slot>...
#   <seed dir> holds seed-pre.sqlite and seed-post.sqlite (synth-seed.ts doctor on each base).
set -uo pipefail
pre=$(realpath "$1") post=$(realpath "$2") seeds=$(realpath "$3") out=$(realpath -m "$4") job=$5
shift 5
mkdir -p "$out"
iotap=$out/iotap.so
[ -f "$iotap" ] || cc -O2 -shared -fPIC -o "$iotap" "$post/bench/poh/iotap.c" -ldl
run_arm() { # <slot> <arm>
  local dir=$out/$job-$1-$2 base=${2%-*} env=() checkout
  [ -f "$dir/run.json" ] && { echo "[$(date -Is)] $job slot $1 $2 done already"; return 0; }
  case $base in pre) checkout=$pre ;; post) checkout=$post ;; esac
  [ "${2#*-}" = w25 ] && env=(--server-env T3CODE_EXPERIMENTAL_COMMIT_WINDOW_MS=25)
  for attempt in 1 2; do
    rm -rf "$dir"
    echo "[$(date -Is)] start $job slot $1 $2 attempt $attempt"
    (cd "$checkout" && timeout 1500 node bench/poh/bench.ts --seed "$seeds/seed-$base.sqlite" \
      --iotap "$iotap" --runs 1 --warm 0 --turns 2 --skip-opens "${env[@]}" --out "$dir") \
      > "$dir.log" 2>&1
    local code=$?
    echo "[$(date -Is)] end $job slot $1 $2 attempt $attempt exit=$code"
    [ $code -eq 0 ] && return 0
    cp "$dir.log" "$dir.attempt$attempt.log"
  done
  return 1
}
failed=0
for slot in "$@"; do
  if [ $((slot % 2)) -eq 0 ]; then arms="pre-off pre-w25 post-off post-w25"; else arms="post-w25 post-off pre-w25 pre-off"; fi
  for arm in $arms; do run_arm "$slot" "$arm" || failed=1; done
done
exit $failed
