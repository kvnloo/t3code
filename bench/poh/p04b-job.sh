#!/usr/bin/env bash
# PoH 04b cloud job: everything one runner does, from committed source and public data only.
# Run from the root of a POST checkout (exp/poh/04b-post29806). It fetches the PRE branch head,
# installs both, runs the commit-window tests on both, generates a synthetic seed with the PRE
# server, gives each base its own doctor pass, runs the interleaved 2x2 slots, then pools them.
#
# usage: bench/poh/p04b-job.sh <pre sha> <job label> <slot>...
# env:   SEED_THREADS (16), SEED_TURNS (960), SEED_CONCURRENCY (8)
# out:   bench-out/<job label>/ (logs, host.json, seed manifests, raw arm dirs, ab.md, ab.json)
set -euo pipefail
pre_sha=$1 job=$2
shift 2
post=$(pwd)
out=$post/bench-out/$job
seeds=$post/.t3/bench/seeds
mkdir -p "$out" "$seeds"
grep -qx 'bench-out/' .git/info/exclude 2>/dev/null || echo 'bench-out/' >> "$(git rev-parse --git-path info/exclude)"
exec > >(tee -a "$out/job.log") 2>&1
step() { echo "[$(date -Is)] == $*"; }

step host
python3 - "$out/host.json" <<'EOF'
import json, os, platform, subprocess, sys
cpu = next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), None)
mem = next((int(l.split()[1]) * 1024 for l in open("/proc/meminfo") if l.startswith("MemTotal")), None)
json.dump({"cpuModel": cpu, "nproc": os.cpu_count(), "memTotal": mem, "kernel": platform.release(),
           "runnerName": os.environ.get("RUNNER_NAME"), "runnerOs": os.environ.get("RUNNER_OS"),
           "githubRunId": os.environ.get("GITHUB_RUN_ID")}, open(sys.argv[1], "w"), indent=1)
EOF
cat "$out/host.json"

step node
want=$(sed -nE 's/.*"node": "\^?([0-9]+)\..*/\1/p' package.json | head -1)
if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) === $want ? 0 : 1)" 2>/dev/null; then
  dist=https://nodejs.org/dist/latest-v$want.x
  tarball=$(curl -fsSL "$dist/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ {print $2}')
  curl -fsSL -o "/tmp/$tarball" "$dist/$tarball"
  (cd /tmp && curl -fsSL "$dist/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c -)
  mkdir -p "$HOME/.p04b-node" && tar -xJf "/tmp/$tarball" -C "$HOME/.p04b-node" --strip-components 1
  export PATH=$HOME/.p04b-node/bin:$PATH
fi
node --version

step checkout PRE "$pre_sha"
pre=$(realpath -m "$post/../pre")
if [ ! -d "$pre" ]; then
  git fetch -q --depth 1 https://github.com/kvnloo/t3code.git "$pre_sha"
  git worktree add -q --detach "$pre" "$pre_sha"
fi
git -C "$pre" rev-parse HEAD; git -C "$post" rev-parse HEAD

install() { # vp i; falls back to the pinned pnpm when the vp bootstrap is unavailable
  local vp_version
  vp_version=$(sed -nE 's/^  vite-plus: ([0-9][^ ]*)$/\1/p' pnpm-workspace.yaml)
  npx -y -p "vite-plus@$vp_version" vp i || corepack pnpm install --frozen-lockfile
}
for dir in "$pre" "$post"; do
  step install "$dir"
  (cd "$dir" && install) > "$out/install-$(basename "$dir").log" 2>&1 || { tail -50 "$out/install-$(basename "$dir").log"; exit 1; }
done

for pair in "pre:$pre" "post:$post"; do
  step tests "${pair%%:*}"
  (cd "${pair#*:}" && node_modules/.bin/vp test run \
    apps/server/src/orchestration-v2/commitWindow.test.ts \
    apps/server/src/orchestration-v2/ProviderEventIngestor.test.ts) > "$out/tests-${pair%%:*}.log" 2>&1 \
    || { tail -80 "$out/tests-${pair%%:*}.log"; exit 1; }
  tail -6 "$out/tests-${pair%%:*}.log"
done

step seed
(cd "$pre" && node bench/poh/synth-seed.ts generate --out "$seeds/seed.sqlite" \
  --threads "${SEED_THREADS:-16}" --turns "${SEED_TURNS:-960}" --concurrency "${SEED_CONCURRENCY:-8}")
(cd "$pre" && node bench/poh/synth-seed.ts doctor --seed "$seeds/seed.sqlite" --out "$seeds/seed-pre.sqlite")
(cd "$post" && node bench/poh/synth-seed.ts doctor --seed "$seeds/seed.sqlite" --out "$seeds/seed-post.sqlite")
rm -f "$seeds/seed.sqlite"
gzip -f "$seeds/synth-server.log"
cp "$seeds"/*.json "$seeds"/*.log "$seeds"/*.gz "$out/"

step bench slots "$@"
code=0
bash "$post/bench/poh/p04b-ab.sh" "$pre" "$post" "$seeds" "$out/raw" "$job" "$@" || code=$?
rm -f "$out/raw/iotap.so"

step pool
python3 "$post/bench/poh/p04b-ab.py" "$out/raw" --json "$out/ab.json" | tee "$out/ab.md"
exit $code
