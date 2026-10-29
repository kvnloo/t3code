"""Local-only P1 capture tests: no kubectl or cluster is contacted."""
import importlib.util
import json
import os
import stat
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('capture.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HASH = 'a' * 64
NAMESPACE = 't3-p1-' + HASH[:24]
PLAN = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': HASH, 'namespace': NAMESPACE}


class Stub:
    def __init__(self, drift=None, broken=None, tamper=None):
        self.calls = []
        self.drift = drift
        self.broken = broken
        self.tamper = tamper

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        assert command[:4] == ['kubectl', '--context', 'disposable-k3s', '--request-timeout=10s']
        assert command[-2:] == ['-o', 'json']
        assert kwargs['timeout'] == 20 and kwargs['check'] is False
        resource = command[command.index('get') + 1]
        remainder = command[command.index('get') + 2:-2]
        name = remainder[0] if remainder else None
        if self.broken == resource:
            return subprocess.CompletedProcess(command, 1, '', 'private kubeconfig detail')
        kinds = {'namespace': 'Namespace', 'pvc': 'PersistentVolumeClaim',
                 'deployment': 'Deployment', 'service': 'Service',
                 'ingress': 'Ingress', 'networkpolicy': 'NetworkPolicy'}
        listed_names = {'networkpolicies': ('networkpolicy', 'worker-ingress'),
                        'ingresses': ('ingress', 't3-worker'),
                        'services': ('service', 't3-worker')}
        if resource in ('networkpolicies', 'ingresses', 'services', 'replicasets', 'pods'):
            items = []
            if resource in listed_names:
                source, selected_name = listed_names[resource]
                items = [{'kind': kinds[source],
                          'metadata': {'name': selected_name, 'namespace': NAMESPACE,
                                       'uid': 'a1234567', 'resourceVersion': '2'},
                          'spec': {'replicas': 1}}]
            obj = {'kind': dict(networkpolicies='NetworkPolicyList', ingresses='IngressList',
                                services='ServiceList', replicasets='ReplicaSetList',
                                pods='PodList')[resource], 'items': items}
        else:
            meta = {'name': name, 'uid': 'a1234567', 'resourceVersion': '2'}
            if resource != 'namespace':
                meta['namespace'] = NAMESPACE
            obj = {'kind': kinds[resource], 'metadata': meta, 'spec': {'replicas': 1}}
        if self.tamper is not None and self.tamper[0] == resource:
            flaw = self.tamper[1]
            if flaw == 'kind':
                obj['kind'] = 'Other'
            elif flaw == 'name':
                obj['metadata']['name'] = 'unrelated'
            elif flaw == 'namespace':
                obj['metadata'].pop('namespace', None)
            elif flaw == 'uid':
                obj['metadata']['uid'] = None
            elif flaw == 'inventory_missing':
                obj['items'] = []
            elif flaw == 'inventory_drift':
                obj['items'][0]['spec']['replicas'] = 2
        if self.drift == resource and len([c for c in self.calls if resource in c]) > 1:
            obj['metadata'] = {'resourceVersion': '3'}
        return subprocess.CompletedProcess(command, 0, json.dumps(obj), '')


class CaptureTests(unittest.TestCase):
    def test_read_only_explicit_context_and_stable_snapshot(self):
        stub = Stub()
        records = module.capture('disposable-k3s', PLAN, runner=stub)
        self.assertEqual(len(records), 11)
        self.assertEqual(len(stub.calls), 22)
        self.assertTrue(all('get' in c and 'apply' not in c and 'delete' not in c
                            and 'patch' not in c for c in stub.calls))
        self.assertTrue(all('--context' in c for c in stub.calls))

    def test_reject_stale_or_unsafe_plan(self):
        for ctx in ('', '-bad', 'disposable\ncluster', ' spaced '):
            with self.subTest(ctx=ctx), self.assertRaises(module.CaptureError):
                module.capture(ctx, PLAN, runner=Stub())
        for altered in ({}, {**PLAN, 'namespace': 'existing-home'},
                        {**PLAN, 'leaseHash': 'bad'}):
            with self.subTest(plan=altered), self.assertRaises(module.CaptureError):
                module.capture('disposable-k3s', altered, runner=Stub())

    def test_detect_change_in_named_resource_or_inventory(self):
        for res in ('deployment', 'ingresses', 'pods'):
            with self.subTest(resource=res), self.assertRaises(module.CaptureError):
                module.capture('disposable-k3s', PLAN, runner=Stub(drift=res))

    def test_named_identity_and_mixed_inventory_fail_closed(self):
        cases = (
            ('deployment', 'kind'), ('deployment', 'name'),
            ('deployment', 'namespace'), ('deployment', 'uid'),
            ('namespace', 'name'), ('services', 'inventory_missing'),
            ('services', 'inventory_drift'), ('ingresses', 'inventory_missing'),
            ('networkpolicies', 'inventory_drift'),
        )
        for case in cases:
            with self.subTest(mutation=case), self.assertRaises(module.CaptureError):
                module.capture('disposable-k3s', PLAN, runner=Stub(tamper=case))

    def test_redacted_rejected_api_read(self):
        with self.assertRaisesRegex(module.CaptureError, 'request rejected') as ctx:
            module.capture('disposable-k3s', PLAN, runner=Stub(broken='pods'))
        self.assertNotIn('private', str(ctx.exception))

    def test_concurrent_empty_destination_cannot_replace_existing_evidence(self):
        # Reproduce a writer creating the final directory after publish()'s
        # initial absence check. Plain os.rename() would replace that empty
        # directory; renameat2(RENAME_NOREPLACE) must preserve its inode.
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / 'owner'
            parent.mkdir(mode=0o700)
            target = parent / 'snapshot'
            make_temp = module.tempfile.mkdtemp
            competing_inode = []

            def race(*args, **kwargs):
                staging = make_temp(*args, **kwargs)
                target.mkdir()
                competing_inode.append(target.stat().st_ino)
                return staging

            with mock.patch.object(module.tempfile, 'mkdtemp', side_effect=race):
                with self.assertRaises(module.CaptureError):
                    module.publish({'pods': {'kind': 'PodList', 'items': []}}, target)
            self.assertEqual(target.stat().st_ino, competing_inode[0])
            self.assertEqual(list(parent.iterdir()), [target])

    def test_staging_directory_fsync_precedes_parent_publication(self):
        # A file's fsync does not make its *directory entry* crash durable.
        # The staging directory must be synced before renameat2 exposes it.
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / 'owner'
            parent.mkdir(mode=0o700)
            target = parent / 'snapshot'
            events = []
            original_fsync = os.fsync

            def record_fsync(fd):
                events.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode)
                              else 'file')
                return original_fsync(fd)

            with mock.patch.object(module.os, 'fsync', side_effect=record_fsync):
                module.publish({'pods': {'kind': 'PodList', 'items': []}}, target)
            self.assertEqual(events, ['file', 'directory', 'directory'])
            self.assertEqual(json.loads((target / 'pods.json').read_text())['kind'],
                             'PodList')

    def test_staging_directory_sync_failure_cannot_publish(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / 'owner'
            parent.mkdir(mode=0o700)
            target = parent / 'snapshot'
            original_fsync = os.fsync

            def reject_directory_fsync(fd):
                if stat.S_ISDIR(os.fstat(fd).st_mode):
                    raise OSError('injected staging-directory fsync failure')
                return original_fsync(fd)

            with mock.patch.object(module.os, 'fsync',
                                   side_effect=reject_directory_fsync):
                with self.assertRaises(OSError):
                    module.publish({'pods': {'kind': 'PodList', 'items': []}}, target)
            self.assertFalse(target.exists())
            self.assertEqual(list(parent.iterdir()), [])

    def test_publish_private_atomic_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / 'owner'
            parent.mkdir(mode=0o700)
            target = parent / 'snapshot'
            module.publish({'pods': {'kind': 'PodList', 'items': []}}, target)
            self.assertEqual(json.loads((target / 'pods.json').read_text())['kind'], 'PodList')
            self.assertEqual((target / 'pods.json').stat().st_mode & 0o777, 0o600)
            with self.assertRaises(module.CaptureError):
                module.publish({'pods': {}}, target)
            os.chmod(parent, 0o755)
            with self.assertRaises(module.CaptureError):
                module.publish({'pods': {}}, parent / 'another')


if __name__ == '__main__':
    unittest.main()
