#!/usr/bin/env bash
# PoH 04c: the 25 ms commit window on real provider turns. For each slot, every provider runs both
# shapes (s1: one thread at a time, s4: four threads dispatched together), each with the window off
# and at 25 ms, in the order off w25 on even slots and w25 off on odd ones (ABBA across slots).
# Every arm is one server boot on a fresh copy of the same seed (bench/poh/real-turns.ts).
# Resumable: an arm whose run.json exists is skipped. A failed arm is retried once.
#
# usage: p04c-ab.sh <seed.sqlite> <out dir> <slot>...
# env:   PROVIDERS   space-separated <label>:<instanceId>:<model>[:<opt=v,opt=v>]
#        S4_BATCHES  s4 batches per arm (default 2); slot s runs batches s*S4_BATCHES onwards
#        SHAPES      default "s1 s4"
set -uo pipefail
seed=$(realpath "$1") out=$(realpath -m "$2")
shift 2
here=$(cd "$(dirname "$0")/../.." && pwd)
batches=${S4_BATCHES:-2}
mkdir -p "$out"
iotap=$out/iotap.so
[ -f "$iotap" ] || cc -O2 -shared -fPIC -o "$iotap" "$here/bench/poh/iotap.c" -ldl
run_arm() { # <slot> <provider spec> <shape> <arm>
  local slot=$1 label instance model opts shape=$3 arm=$4 env=() options=()
  IFS=: read -r label instance model opts <<< "$2"
  local dir=$out/$label-$shape-$slot-$arm
  [ -f "$dir/run.json" ] && { echo "[$(date -Is)] $label $shape slot $slot $arm done already"; return 0; }
  [ "$arm" = w25 ] && env=(--server-env T3CODE_EXPERIMENTAL_COMMIT_WINDOW_MS=25)
  if [ -n "$opts" ]; then
    IFS=, read -ra pairs <<< "$opts"
    for pair in "${pairs[@]}"; do options+=(--option "$pair"); done
  fi
  for attempt in 1 2; do
    rm -rf "$dir"
    echo "[$(date -Is)] start $label $shape slot $slot $arm attempt $attempt"
    (cd "$here" && timeout 5400 node bench/poh/real-turns.ts --seed "$seed" --iotap "$iotap" \
      --instance "$instance" --model "$model" "${options[@]}" --shape "$shape" \
      --batches "$batches" --batch-offset $((slot * batches)) "${env[@]}" --out "$dir") \
      > "$dir.log" 2>&1
    local code=$?
    echo "[$(date -Is)] end $label $shape slot $slot $arm attempt $attempt exit=$code"
    [ $code -eq 0 ] && return 0
    cp "$dir.log" "$dir.attempt$attempt.log"
  done
  return 1
}
failed=0
for slot in "$@"; do
  if [ $((slot % 2)) -eq 0 ]; then arms="off w25"; else arms="w25 off"; fi
  for spec in $PROVIDERS; do
    for shape in ${SHAPES:-s1 s4}; do
      for arm in $arms; do run_arm "$slot" "$spec" "$shape" "$arm" || failed=1; done
    done
  done
done
exit $failed
