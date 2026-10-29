"""Local-only P1 capture tests: no kubectl or cluster is contacted."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('capture.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HASH = 'a' * 64
NAMESPACE = 't3-p1-' + HASH[:24]
PLAN = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': HASH, 'namespace': NAMESPACE}


class Stub:
    def __init__(self, drift=None, broken=None):
        self.calls = []
        self.drift = drift
        self.broken = broken

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
        if resource in ('networkpolicies', 'ingresses', 'services', 'replicasets', 'pods'):
            obj = {'kind': dict(networkpolicies='NetworkPolicyList', ingresses='IngressList',
                                services='ServiceList', replicasets='ReplicaSetList',
                                pods='PodList')[resource], 'items': []}
        else:
            obj = {'kind': resource, 'metadata': {'name': name, 'namespace': NAMESPACE,
                                                  'uid': 'a1234567', 'resourceVersion': '2'},
                   'spec': {'replicas': 1}}
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

    def test_redacted_rejected_api_read(self):
        with self.assertRaisesRegex(module.CaptureError, 'request rejected') as ctx:
            module.capture('disposable-k3s', PLAN, runner=Stub(broken='pods'))
        self.assertNotIn('private', str(ctx.exception))

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
