#!/usr/bin/env python3
"""Run the existing analyzer against its real frozen corpus, before and after."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import tarfile

HERE = Path(__file__).resolve().parent
# Fleet source shipping excludes ignored fixtures; --input stages this exact archive.
if (HERE / 'inputs.tar').is_file():
    with tarfile.open(HERE / 'inputs.tar') as archive:
        archive.extractall(HERE, filter='data')


def check(graph):
    missing = [edge for edge in graph['edges']
               if edge['src'] not in graph['nodes'] or edge['dst'] not in graph['nodes']]
    if missing:
        raise ValueError(f'{len(missing)} edges reference absent nodes')


def run(name):
    with tempfile.TemporaryDirectory(prefix='ayo-O05-graph-') as directory:
        root = Path(directory)
        source = HERE / name
        (root / 'analyze.py').write_bytes(source.read_bytes())
        (root / 'corpus').symlink_to(HERE / 'corpus', target_is_directory=True)
        result = subprocess.run([sys.executable, str(root / 'analyze.py')],
                                capture_output=True, text=True,
                                env={**os.environ, 'PYTHONHASHSEED': '0'})
        (HERE / f'{name}.log').write_text(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(f'{name} exited {result.returncode}')
        return json.loads((root / 'graph.json').read_text())


before = run('analyze-base.py')
assert before == run('analyze-base.py'), 'The original analyzer output is not repeatable'
print('REPEATABILITY: two original runs match with PYTHONHASHSEED=0', flush=True)
try:
    check(before)
except ValueError as error:
    print(f'BASE RED: {error}', flush=True)
else:
    raise AssertionError('Expected the real corpus to reproduce the missing-node defect')
after = run('analyze.py')
check(after)
print('HEAD GREEN: all edge endpoints exist', flush=True)
assert after['edges'] == before['edges'], 'The patch must not change dependency or conflict edges'
assert all(after['nodes'][key] == value for key, value in before['nodes'].items())
added = sorted(set(after['nodes']) - set(before['nodes']))
assert added and all(after['nodes'][key]['group'] == 'reference' for key in added)
print(f'PRESERVATION: {len(before["edges"])} unchanged edges; {len(added)} reference nodes added', flush=True)
control = {'nodes': dict(after['nodes']), 'edges': after['edges']}
del control['nodes'][after['edges'][0]['dst']]
try:
    check(control)
except ValueError as error:
    print(f'NEGATIVE CONTROL: {error}', flush=True)
else:
    raise AssertionError('The invariant checker accepted a missing endpoint')
receipt = {
    'base_red': True, 'head_green': True, 'negative_control_red': True,
    'baseline_repeatable': True, 'python_hash_seed': '0',
    'edges_unchanged': len(before['edges']), 'original_nodes_unchanged': len(before['nodes']),
    'reference_nodes_added': added,
    'base_sha256': hashlib.sha256((HERE / 'analyze-base.py').read_bytes()).hexdigest(),
    'patched_sha256': hashlib.sha256((HERE / 'analyze.py').read_bytes()).hexdigest(),
    'corpus_sha256': {str(path.relative_to(HERE)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in sorted((HERE / 'corpus').rglob('*')) if path.is_file()},
}
(HERE / 'PROOF.json').write_text(json.dumps(receipt, indent=2) + '\n')
print('PASS: actual analyzer output, not a synthetic graph or source-text assertion', flush=True)
