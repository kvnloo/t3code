#!/usr/bin/env python3
"""Check the C01 evidence bundle without opening a database or changing schedules."""
import json
from pathlib import Path
import sys

bundle = Path(sys.argv[1])
snapshot = json.loads((bundle / 'scheduler-current.json').read_text())
reconciliation = json.loads((bundle / 'reconciliation.json').read_text())
summary = reconciliation['summary']
mapping = reconciliation['mapping']
tasks = snapshot['tasks']
assert len(tasks) == len({t['task_id'] for t in tasks}) == 10
assert len(mapping) == len({r['old_id'] for r in mapping}) == 8
assert sum(r['old_id'] != r['current_id'] for r in mapping) == 2
assert all(r['cadence_preserved'] and r['prompt_preserved'] and r['binding_matches'] for r in mapping)
assert summary['lane_count'] == summary['distinct_lane_threads'] == 5
manifest = json.loads(Path('/mnt/zer0models/workspace/zer0/data/operations/t3-thread-triage/20261104/handoffs/MANIFEST.json').read_text())
assert len(manifest['lanes']) == len({lane['threadId'] for lane in manifest['lanes']}) == 5
assert all(snapshot['threads'][lane['threadId']]['exists'] and snapshot['threads'][lane['threadId']]['pinnedAt'] is not None for lane in manifest['lanes'])
once = [t for t in tasks if json.loads(t['schedule_json'])['type'] == 'once']
assert len(once) == 2
assert all(t['run_count'] == 1 and t['last_run_status'] == 'succeeded' and t['next_run_at'] is None for t in once)
assert all(t['dispatch_messages'][-1]['run_status'] == 'completed' for t in once)
recurring = [t for t in tasks if json.loads(t['schedule_json'])['type'] != 'once']
assert len(recurring) == 8 and all(not t['enabled'] for t in recurring)
assert all(len(t['dispatch_messages']) == t['run_count'] for t in tasks)
assert len(summary['last_dispatch_associated_run_failed']) == 2
assert not summary['literal_acceptance_met']
assert not summary['exactly_once_execution_verified']
assert not summary['supported_api_readback_obtained']
assert all('prompt' not in t and 'webhook_token' not in t and 'webhook_secret' not in t for t in tasks)
assert (bundle / 'RECONCILIATION.md').read_text().count('\n| ') == 9
for name in ('scheduler-current.json', 'reconciliation.json', 'RECONCILIATION.md'):
    assert (bundle / name).read_bytes() == (bundle / 'replay' / name).read_bytes()
print('PASS: 5 proposed lanes, 8 mapped originals, 10 unique rows, 2 ID replacements.')
print('PASS: unchanged cadence/prompt hashes and recorded bindings for all 8 originals.')
print('PASS: 8 paused recurring rows = 6 logical workflows plus 2 retired originals.')
print('PASS: both once tasks have one retained dispatch and completed run status.')
print('PASS: all 10 dispatch counts match counters; 2 latest associated runs failed.')
print('PASS: metadata-only export and byte-identical offline replay.')
print('NOT ACCEPTED: literal IDs, supported API readback, and exactly-once effects remain unresolved.')
