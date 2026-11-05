# O05 graph-builder patch proof

This directory holds a local draft patch and a rerunnable proof for the existing UX research analyzer. It does not change T3 product code. Do not open an upstream T3 PR for this tooling.

The source is `/mnt/zer0models/workspace/zer0/data/operations/t3code-ux-bundle/20261104/analyze.py`, SHA-256 `61d6c9a0e23a5f0f22778d1de12f9a8ea02547f440a26fbb8173a6a00b11e9c9`. Its edges can reference open PRs outside its UX node subset. `ANALYZE-FIX.patch` adds those nodes from the existing open-PR corpus and rejects missing endpoints before export. It does not change dependency or conflict edges.

The shared source and historical graph remain untouched. Local staging files and corpus copies are ignored, not part of the commit. They contain only the existing analyzer and its public corpus or file lists.

## Reproduce off-host

From the checkout root, stage the existing source as both `analyze-base.py` and `analyze.py` in this directory. Stage its `corpus/open-prs.json`, `corpus/discussions.json`, `corpus/ux-candidates.json`, `corpus/redesign-stack-files.json`, and `corpus/prfiles/` here. Apply the draft only to the staged `analyze.py`.

Run:

```sh
fleet-build --node mbp --light --wait 1800 --src-include scripts/ayo-O05-graph --fetch scripts/ayo-O05-graph/PROOF.json -- python3 scripts/ayo-O05-graph/proof.py
```

`proof.py` invokes the actual analyzer twice, using temporary output directories and a read-only corpus reference. The source corpus is never rewritten. It requires the original to fail the endpoint invariant and the patched analyzer to pass. It also checks that every original node and edge remains unchanged, then removes an endpoint as a negative control.

The authoritative execution status is in `/mnt/zer0models/workspace/zer0/data/operations/intent-analyzer-20261104/ayo-runs/exec-O05/REPORT.md`. A draft patch or this README alone is not a passing receipt.
