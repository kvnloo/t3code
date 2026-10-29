"""Offline malicious-route regression cases; no cluster/network required."""
import copy
import importlib.util
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('route_check', HERE / 'route_check.py')
assert spec and spec.loader
rc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rc)

H = 'a' * 64
N = 't3-p1-' + H[:24]
PLAN = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': H, 'namespace': N}
S = {'kind': 'Service', 'metadata': {'name': 't3-worker', 'namespace': N},
     'spec': {'type': 'ClusterIP', 'selector': {'app': 't3-worker'},
              'ports': [{'name': 'http', 'port': 80, 'targetPort': 'http'}]}}
I = {'kind': 'Ingress', 'metadata': {'name': 't3-worker', 'namespace': N},
     'spec': {'ingressClassName': 'tailscale', 'tls': [{'hosts': [N]}],
              'defaultBackend': {'service': {'name': 't3-worker', 'port': {'name': 'http'}}}}}
P = {'kind': 'NetworkPolicy', 'metadata': {'name': 'worker-ingress', 'namespace': N,
     'uid': '11111111-aaaa-bbbb-cccc-111111111111'},
     'spec': {'podSelector': {'matchLabels': {'app': 't3-worker'}}, 'policyTypes': ['Ingress'],
              'ingress': [{'from': [{'namespaceSelector': {'matchLabels': {
                  'kubernetes.io/metadata.name': 'tailscale'}}}],
                  'ports': [{'protocol': 'TCP', 'port': 3773}]}]}}

ALL = {'kind': 'NetworkPolicyList', 'items': [copy.deepcopy(P)]}


class RouteTests(unittest.TestCase):
    def test_matching_private_route(self):
        rc.verify(PLAN, S, I, P, ALL)
        s = copy.deepcopy(S)
        s['spec']['ports'][0]['protocol'] = 'TCP'  # normal API default
        i = copy.deepcopy(I)
        i['metadata']['annotations'] = {'kubectl.kubernetes.io/last-applied-configuration': '...'}
        rc.verify(PLAN, s, i, P, ALL)

    def test_reject_public_service_and_route_drift(self):
        changes = [
            (1, ('spec', 'type'), 'LoadBalancer'),
            (1, ('spec', 'type'), 'NodePort'),
            (1, ('spec', 'externalIPs'), ['8.8.8.8']),
            (1, ('spec', 'ports'), [{'name': 'http', 'port': 80, 'targetPort': 'http', 'nodePort': 30080}]),
            (1, ('spec', 'selector'), {'app': 'other'}),
            (2, ('spec', 'ingressClassName'), 'nginx'),
            (2, ('spec', 'rules'), [{'host': 'public.example.net'}]),
            (2, ('spec', 'tls'), [{'hosts': ['public.example.net']}]),
            (2, ('metadata', 'annotations'), {'tailscale.com/funnel': 'true'}),
            (2, ('spec', 'defaultBackend'), {'service': {'name': 'other', 'port': {'name': 'http'}}}),
            (3, ('spec', 'ingress'), [{'from': [{'ipBlock': {'cidr': '0.0.0.0/0'}}]}]),
            (3, ('spec', 'policyTypes'), ['Ingress', 'Egress']),
            (3, ('spec', 'podSelector'), {}),
        ]
        for idx, keys, value in changes:
            with self.subTest(idx=idx, key=keys):
                args = copy.deepcopy([PLAN, S, I, P, ALL])
                cursor = args[idx]
                for key in keys[:-1]:
                    cursor = cursor[key]
                cursor[keys[-1]] = value
                with self.assertRaises(rc.RouteError):
                    rc.verify(*args)

    def test_reject_invalid_namespace_or_malformed_api_snapshots(self):
        for plan in ({**PLAN, 'namespace': 'other'}, {**PLAN, 'leaseHash': 'not-hex'},
                     {**PLAN, 'format': 'other'}):
            with self.subTest(plan=plan), self.assertRaises(rc.RouteError):
                rc.verify(plan, S, I, P, ALL)
        for idx in (1, 2, 3):
            for invalid in (None, [], {'kind': 'other'}, {'kind': 'Service', 'metadata': None}):
                args = copy.deepcopy([PLAN, S, I, P, ALL])
                args[idx] = invalid
                with self.subTest(idx=idx, invalid=invalid), self.assertRaises(rc.RouteError):
                    rc.verify(*args)

    def test_reject_additive_or_inconsistent_policy_inventory(self):
        rc.verify(PLAN, S, I, P, ALL)
        wildcard = {'kind': 'NetworkPolicy',
                    'metadata': {'name': 'allow-anywhere', 'namespace': N,
                                 'uid': '22222222-aaaa-bbbb-cccc-222222222222'},
                    'spec': {'podSelector': {}, 'policyTypes': ['Ingress'],
                             'ingress': [{}]}}
        inventory_cases = [
            None, [], {},
            {'kind': 'List', 'items': [copy.deepcopy(P)]},
            {'kind': 'NetworkPolicyList', 'items': []},
            {'kind': 'NetworkPolicyList', 'items': [copy.deepcopy(P), wildcard]},
        ]
        for bad in inventory_cases:
            with self.subTest(bad=bad), self.assertRaises(rc.RouteError):
                rc.verify(PLAN, S, I, P, bad)
        for key, value in [
            ('uid', 'different-uid-xxxxxxxxx'),
            ('name', 'allow-anywhere'),
            ('namespace', 'other-namespace'),
            ('deletionTimestamp', '2026-10-29T00:00:00Z'),
        ]:
            bad = copy.deepcopy(ALL)
            bad['items'][0]['metadata'][key] = value
            with self.subTest(field=key), self.assertRaises(rc.RouteError):
                rc.verify(PLAN, S, I, P, bad)
        bad = copy.deepcopy(ALL)
        bad['items'][0]['spec']['ingress'] = [{}]
        with self.assertRaises(rc.RouteError):
            rc.verify(PLAN, S, I, P, bad)
        bad = copy.deepcopy(P)
        bad['metadata']['uid'] = 'different-uid-xxxxxxxxx'
        with self.assertRaises(rc.RouteError):
            rc.verify(PLAN, S, I, bad, ALL)

    def test_cli_no_network_and_no_private_details(self):
        with tempfile.TemporaryDirectory() as d:
            paths = [Path(d) / x for x in ('plan.json', 'service.json', 'ingress.json', 'policy.json', 'all-policies.json')]
            for path, obj in zip(paths, (PLAN, S, I, P, ALL)):
                path.write_text(json.dumps(obj))
            args = [sys.executable, str(HERE / 'route_check.py'), '--plan', str(paths[0]),
                    '--service', str(paths[1]), '--ingress', str(paths[2]),
                    '--network-policy', str(paths[3]),
                    '--all-network-policies', str(paths[4])]
            good = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertEqual(good.returncode, 0, good.stderr)
            self.assertIn('offline only', good.stdout)
            bad_i = copy.deepcopy(I)
            bad_i['metadata']['annotations'] = {'tailscale.com/funnel': 'true'}
            paths[2].write_text(json.dumps(bad_i))
            bad = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertNotEqual(bad.returncode, 0)
            self.assertNotIn(N, bad.stderr)
            self.assertNotIn('tailscale.com/funnel', bad.stderr)
            paths[2].write_text(json.dumps(I))
            wide = copy.deepcopy(ALL)
            wide['items'].append({
                'kind': 'NetworkPolicy', 'metadata': {'name': 'allow-all', 'namespace': N},
                'spec': {'podSelector': {}, 'policyTypes': ['Ingress'], 'ingress': [{}]}})
            paths[4].write_text(json.dumps(wide))
            missing_inventory = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertNotEqual(missing_inventory.returncode, 0)
            self.assertNotIn(N, missing_inventory.stderr)


if __name__ == '__main__':
    unittest.main()
