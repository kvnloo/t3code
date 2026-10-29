"""P1 manifest/lease contract: deterministic, no network, kubectl or scheduler."""
import importlib.util
from pathlib import Path
import json
import os
import tempfile
import unittest

import yaml

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('p1_plan', HERE / 'plan.py')
assert spec and spec.loader
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

IMAGE = 'ghcr.io/owned/t3-worker@sha256:' + 'a' * 64
EXPIRY = '2026-11-01T00:00:00Z'


class P1PlanTests(unittest.TestCase):
    def test_deterministic_names_and_same_input(self):
        a, objs = p.build('work-item:abc-23', IMAGE, EXPIRY)
        b, again = p.build('work-item:abc-23', IMAGE, EXPIRY)
        self.assertEqual(a, b)
        self.assertEqual(yaml.safe_dump_all(objs), yaml.safe_dump_all(again))
        c, _ = p.build('work-item:abc-24', IMAGE, EXPIRY)
        self.assertNotEqual(a['namespace'], c['namespace'])
        self.assertNotIn('work-item:abc', yaml.safe_dump_all(objs))
        self.assertNotIn('work-item:abc', json.dumps(a))

    def test_only_bounded_private_k8s_resources(self):
        plan, docs = p.build('work:1', IMAGE, EXPIRY)
        self.assertEqual([d['kind'] for d in docs], ['Namespace', 'ResourceQuota',
                         'ServiceAccount', 'PersistentVolumeClaim', 'Deployment',
                         'Service', 'Ingress', 'NetworkPolicy'])
        self.assertTrue(all(d['metadata']['namespace'] == plan['namespace']
                            for d in docs[1:]))
        self.assertEqual(docs[0]['metadata']['labels']['pod-security.kubernetes.io/enforce'], 'restricted')
        self.assertEqual(docs[0]['metadata']['annotations']['t3code.dev/expiry-enforced'], 'false')
        self.assertEqual(docs[1]['spec']['hard']['pods'], '1')
        self.assertFalse(docs[2]['automountServiceAccountToken'])
        pod = docs[4]['spec']['template']['spec']
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertTrue(pod['securityContext']['runAsNonRoot'])
        self.assertEqual(docs[4]['spec']['strategy']['type'], 'Recreate')
        self.assertEqual(pod['containers'][0]['image'], IMAGE)
        self.assertEqual(pod['containers'][0]['securityContext']['capabilities']['drop'], ['ALL'])
        self.assertTrue(pod['containers'][0]['securityContext']['readOnlyRootFilesystem'])
        self.assertTrue(any(v.get('persistentVolumeClaim', {}).get('claimName') == 't3-worker-data'
                            for v in pod['volumes']))
        self.assertFalse(any('hostPath' in v for v in pod['volumes']))
        self.assertEqual(docs[5]['spec']['type'], 'ClusterIP')
        self.assertEqual(docs[6]['spec']['ingressClassName'], 'tailscale')
        self.assertNotIn('rules', docs[6]['spec'])
        self.assertNotIn('tailscale.com/funnel', docs[6]['metadata'].get('annotations', {}))
        self.assertEqual(docs[7]['spec']['policyTypes'], ['Ingress'])
        self.assertEqual(docs[7]['spec']['ingress'][0]['ports'][0]['port'], 3773)
        self.assertEqual(docs[7]['spec']['ingress'][0]['from'][0]['namespaceSelector']
                         ['matchLabels']['kubernetes.io/metadata.name'], 'tailscale')
        self.assertEqual([d['kind'] for d in yaml.safe_load_all(yaml.safe_dump_all(docs))],
                         [d['kind'] for d in docs])

    def test_bad_keys_images_and_expiries_fail_closed(self):
        for key in ('', '/bad', '-bad', '../steal', 'a\nkind:Pod', 'x' * 129):
            with self.subTest(key=key), self.assertRaises(p.PlanError):
                p.build(key, IMAGE, EXPIRY)
        for image in ('t3:latest', 't3@sha256:' + 'a' * 64,
                      IMAGE.upper(), IMAGE + '\n---\nkind: Pod',
                      'ghcr.io/x/../y@sha256:' + 'a' * 64):
            with self.subTest(image=image), self.assertRaises(p.PlanError):
                p.build('work:1', image, EXPIRY)
        for date in ('', 'tomorrow', '2026-02-30T00:00:00Z',
                     '2026-11-01T00:00:00+01:00', '2000-01-01T00:00:00Z'):
            with self.subTest(date=date), self.assertRaises(p.PlanError):
                p.build('work:1', IMAGE, date)

    def test_local_receipt_is_0600_and_conflicts_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp) / 'private'
            base.mkdir(mode=0o700)
            plan, docs = p.build('work:1', IMAGE, EXPIRY)
            self.assertTrue(p.lock(base, plan))
            self.assertFalse(p.lock(base, plan))
            path = base / (plan['leaseHash'] + '.json')
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertNotIn('work:1', path.read_text())
            changed = dict(plan, image='ghcr.io/other/w@sha256:' + 'b' * 64)
            with self.assertRaisesRegex(p.PlanError, 'conflicting'):
                p.lock(base, changed)
            path.chmod(0o644)
            with self.assertRaisesRegex(p.PlanError, 'unsafe'):
                p.lock(base, plan)

    def test_rejects_symlinked_or_public_plan_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            private = Path(temp) / 'private'
            private.mkdir(mode=0o700)
            public = Path(temp) / 'public'
            public.mkdir(mode=0o755)
            symlink = Path(temp) / 'alias'
            symlink.symlink_to(private)
            plan, _ = p.build('work:2', IMAGE, EXPIRY)
            with self.assertRaises(p.PlanError):
                p.lock(public, plan)
            with self.assertRaises(p.PlanError):
                p.lock(symlink, plan)
            with self.assertRaises(p.PlanError):
                p.lock(Path('relative'), plan)
            path = private / (plan['leaseHash'] + '.json')
            path.symlink_to(public)
            with self.assertRaises(p.PlanError):
                p.lock(private, plan)


if __name__ == '__main__':
    unittest.main()
