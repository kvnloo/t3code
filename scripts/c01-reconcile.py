#!/usr/bin/env python3
"""Capture non-secret scheduler metadata read-only, or replay a saved capture."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3


ROOT = Path('/mnt/zer0models/workspace/zer0/data/operations/t3-thread-triage/20261104')
CHIEF = 'mcp:launch:b4bfec5c13750ce5aa27eb25cc2af462b540fec86c097e1eea7b85f5a40dd7d7'


def load(path):
    return json.loads(path.read_text())


def capture(db, lanes):
    con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA query_only=ON')
    con.execute('BEGIN')
    columns = ('task_id,title,enabled,schedule_json,project_id,thread_id,'
               'next_run_at,last_run_at,last_run_status,run_count,updated_at')
    tasks = [dict(r) for r in con.execute(f'SELECT {columns} FROM scheduled_tasks ORDER BY task_id')]
    # Hash prompts for equivalence checks. Never export prompt text or webhook credentials.
    hashes = {r[0]: hashlib.sha256(r[1].encode()).hexdigest()
              for r in con.execute('SELECT task_id,prompt FROM scheduled_tasks')}
    ids = {x['threadId'] for x in lanes} | {CHIEF} | {t['thread_id'] for t in tasks}
    threads = {}
    for tid in sorted(ids - {None}):
        row = con.execute('SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id=?', (tid,)).fetchone()
        p = json.loads(row[0]) if row else {}
        threads[tid] = {k: p.get(k) for k in ('id', 'projectId', 'title', 'pinnedAt', 'settledAt', 'archivedAt', 'deletedAt')}
        threads[tid]['exists'] = row is not None
    for task in tasks:
        task['prompt_sha256'] = hashes[task['task_id']]
        prefix = 'scheduled-task-message:' + task['task_id'] + ':'
        sql = '''SELECT m.message_id,m.thread_id,m.run_id,m.created_at,
                 r.status AS run_status,r.completed_at
                 FROM orchestration_v2_projection_messages m
                 LEFT JOIN orchestration_v2_projection_runs r ON r.run_id=m.run_id
                 WHERE m.message_id>=? AND m.message_id<? ORDER BY m.created_at'''
        task['dispatch_messages'] = [dict(r) for r in con.execute(sql, (prefix, prefix + '\uffff'))]
    con.rollback()
    con.close()
    return {'captured_at': datetime.now(timezone.utc).isoformat(), 'database': str(db),
            'transport': 'SQLite mode=ro; PRAGMA query_only=ON; one read transaction; not MCP readback',
            'tasks': tasks, 'threads': threads}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--database', type=Path)
    mode.add_argument('--snapshot', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    lanes = load(ROOT / 'handoffs/MANIFEST.json')['lanes']
    before = load(ROOT / 'recurring-consolidation/before.json')['tasks']
    receipts = {}
    for path in sorted((ROOT / 'recurring-consolidation').glob('*-receipt.json')):
        for i, item in enumerate(load(path)['tasks']):
            receipts[item['oldTaskId']] = (item, path, i)
    snapshot = capture(args.database, lanes) if args.database else load(args.snapshot)
    current = {t['task_id']: t for t in snapshot['tasks']}
    mapping = []
    for old in before:
        tid = old['task_id']
        receipt, path, index = receipts.get(tid, ({}, ROOT / 'recurring-consolidation/before.json', None))
        new_id = receipt.get('newTaskId', tid)
        now = current.get(new_id)
        target = receipt.get('boundThreadId', old['thread_id'])
        mapping.append({'title': old['title'], 'old_id': tid, 'current_id': new_id,
                        'expected_thread': target, 'id_preserved': tid == new_id,
                        'cadence_preserved': now is not None and json.loads(old['schedule_json']) == json.loads(now['schedule_json']),
                        'prompt_preserved': now is not None and hashlib.sha256(old['prompt'].encode()).hexdigest() == now['prompt_sha256'],
                        'enabled_before': bool(old['enabled']),
                        'binding_matches': now is not None and now['thread_id'] == target,
                        'source': str(path), 'receipt_index': index, 'current': now})
    enabled = [t for t in snapshot['tasks'] if t['enabled']]
    active_recurring = [t for t in enabled if json.loads(t['schedule_json'])['type'] != 'once']
    duplicate_keys = Counter((t['prompt_sha256'], t['schedule_json']) for t in active_recurring)
    orphans = [t['task_id'] for t in active_recurring if not snapshot['threads'].get(t['thread_id'], {}).get('exists')
               or snapshot['threads'][t['thread_id']]['deletedAt'] is not None
               or snapshot['threads'][t['thread_id']]['projectId'] != t['project_id']]
    summary = {'lane_count': len(lanes), 'distinct_lane_threads': len({x['threadId'] for x in lanes}),
               'current_task_rows': len(current), 'mapped_original_rows': len(mapping),
               'id_replacements': sum(not x['id_preserved'] for x in mapping),
               'cadence_changes': sum(not x['cadence_preserved'] for x in mapping),
               'prompt_changes': sum(not x['prompt_preserved'] for x in mapping),
               'binding_mismatches': sum(not x['binding_matches'] for x in mapping),
               'active_recurring': len(active_recurring), 'active_recurring_orphans': orphans,
               'duplicate_active_prompt_and_schedule_groups': sum(n > 1 for n in duplicate_keys.values()),
               'disabled_recurring_rows_including_retired_originals': sum(not t['enabled'] and json.loads(t['schedule_json'])['type'] != 'once' for t in current.values()),
               'disabled_logical_recurring_workflows': sum(x['current'] is not None and not x['current']['enabled'] and json.loads(x['current']['schedule_json'])['type'] != 'once' for x in mapping),
               'retained_message_count_matches_run_count': sum(len(t['dispatch_messages']) == t['run_count'] for t in current.values()),
               'last_dispatch_associated_run_failed': [t['task_id'] for t in current.values() if t['dispatch_messages'] and t['dispatch_messages'][-1]['run_status'] == 'failed'],
               'literal_acceptance_met': False, 'exactly_once_execution_verified': False,
               'supported_api_readback_obtained': False}
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in (('scheduler-current.json', snapshot), ('reconciliation.json', {'summary': summary, 'mapping': mapping})):
        (args.output / name).write_text(json.dumps(value, indent=2) + '\n')
    lines = ['# C01 scheduler reconciliation', '',
             f"Observed at `{snapshot['captured_at']}` from `{snapshot['database']}`.",
             'Evidence is a fresh, transaction-consistent local database read, not supported `list_scheduled_tasks` API readback. [Capture](scheduler-current.json:1)', '',
             '## Exactly five proposed views', '',
             'The existing manifest remains the proposal. Chief is a coordination hub, not a sixth lane. No thread or schedule was changed. '
             f'[Lane source]({ROOT}/handoffs/MANIFEST.json:5) [Chief snapshot](scheduler-current.json:1)', '']
    for lane in lanes:
        thread = snapshot['threads'][lane['threadId']]
        lines.append(f"- `{lane['lane']}`: `{lane['threadId']}`, exists={thread['exists']}, pinnedAt=`{thread['pinnedAt']}`. [Source]({ROOT}/handoffs/MANIFEST.json:5) [Current](scheduler-current.json:1)")
    lines += ['', '## Original-to-current reconciliation', '',
              'Each source links the original rows or migration receipt. Current values and run references are in [the capture](scheduler-current.json:1). '
              'The machine-readable [mapping](reconciliation.json:1) preserves full old and replacement IDs.', '',
              '| Workflow | Original ID → current ID | Binding | Cadence, prompt | Enabled before → now; next | Last scheduler dispatch; recorded run | Source |',
              '|---|---|---|---|---|---|---|']
    for row in mapping:
        t = row['current']
        if t is None:
            raise ValueError(f"Missing task {row['current_id']}")
        messages = t['dispatch_messages']
        latest = messages[-1] if messages else None
        run = f"`{latest['run_id']}`: {latest['run_status']}" if latest else 'no retained dispatch message'
        cadence = json.dumps(json.loads(t['schedule_json']), separators=(',', ':'))
        lines.append(f"| {row['title']} | `{row['old_id']}` → `{row['current_id']}` | `{t['thread_id']}`, matches={row['binding_matches']} | `{cadence}`; cadence same={row['cadence_preserved']}, prompt same={row['prompt_preserved']} | {row['enabled_before']} → {bool(t['enabled'])}; `{t['next_run_at']}` | `{t['last_run_at']}`; {t['last_run_status']}; count={t['run_count']}; {run} | [Receipt]({row['source']}:1) |")
    lines += ['', '## Findings and limits', '',
              f"- Two task IDs were replaced. The literal ID-preservation criterion remains unmet. All {len(mapping)} mapped rows retain their original cadence and prompt hash, and match the recorded destination. [Comparison](reconciliation.json:1)",
              '- The hourly renaming replacement changed interval phase during migration. Its hourly duration is unchanged, not its original phase. '
              f'[Receipt]({ROOT}/recurring-consolidation/586f1e46-4fdd-448e-af12-1c7fe2ae5aa4-receipt.json:19)',
              '- All six logical recurring workflows, including Chief, are now disabled. The two retired originals are also disabled. This differs from the saved post-migration snapshot. Nothing was re-enabled. [Current](scheduler-current.json:1) '
              f'[Saved]({ROOT}/recurring-consolidation/schedule-verification.json:1)',
              '- Both once tasks have scheduler status `succeeded`, run_count=1, and next_run_at=null. Enabled=true alone does not establish an orphan. Their retained message and associated run status are in the capture. [Current](scheduler-current.json:1)',
              '- No enabled recurring rows means no current enabled recurring orphan or duplicate prompt/cadence group was observed in this database. This is not proof that recurring work continues, nor that historical execution was exactly once. [Checks](reconciliation.json:1)',
              '- Scheduler `succeeded` means dispatch accepted, not workflow completion. The scheduler queues a message and records the send result before the model workflow completes. '
              '[Source](/mnt/zer0models/workspace/zer0/oss/t3code-wt/nightly-server/apps/server/src/scheduledTasks/ScheduledTaskService.ts:885) '
              '[Result handling](/mnt/zer0models/workspace/zer0/oss/t3code-wt/nightly-server/apps/server/src/scheduledTasks/ScheduledTaskService.ts:921)',
              '- The latest autoresearch and tiny-slm-gym dispatches have associated run status `failed`, despite scheduler status `succeeded`. Both once-task runs are `completed`. Retained dispatch-message counts equal run_count for all ten rows, but this does not prove exactly-once effects. [Run receipts](scheduler-current.json:1) [Checks](reconciliation.json:1)',
              '- Supported API readback for five lanes, Chief, and retired source threads remains unavailable in this run. The MCP endpoint requires a scoped credential, and no MCP server is configured here. No credential was retrieved. '
              '[Authentication contract](/mnt/zer0models/workspace/zer0/oss/t3code-wt/nightly-server/docs/orchestration-v2/orchestrator-mcp-server.md:30)',
              '- Chief and the existing Reliability/task owners must reconcile the paused workflows and obtain supported readback before closure. No schedule recreation, resumption, or acceptance change is proposed as already authorized. '
              f'[Owner](/mnt/zer0models/workspace/zer0/data/operations/owner-message-audit-20261104/REPORT.md:45) [Scope](/mnt/zer0models/workspace/zer0/data/operations/owner-message-audit-20261104/ASK-LEDGER.md:76)', '']
    (args.output / 'RECONCILIATION.md').write_text('\n'.join(lines))
    print(json.dumps(summary, indent=2))
    print('Audit capture and reconciliation completed. This command does not certify acceptance.')


if __name__ == '__main__':
    main()
