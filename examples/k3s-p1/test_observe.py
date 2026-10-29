"""Offline P1 lease/storage binding checks; no Kubernetes/network/secret access."""
import importlib.util
from pathlib import Path
import copy
import json
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('p1_observe', HERE / 'observe.py')
assert spec and spec.loader
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

HASH = 'a' * 64
NAMESPACE = 't3-p1-' + HASH[:24]
EXPIRY = '2026-11-01T00:00:00Z'
PLAN = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': HASH, 'namespace': NAMESPACE,
        'image': 'ghcr.io/owned/t3-worker@sha256:' + 'b' * 64,
        'expiresAt': EXPIRY, 'retention': 'retain'}
NS = {'kind': 'Namespace', 'metadata': {'name': NAMESPACE,
      'uid': '11111111-aaaa-bbbb-cccc-111111111111',
      'labels': {'pod-security.kubernetes.io/enforce': 'restricted'},
      'annotations': {'t3code.dev/lease-key-sha256': HASH,
                      't3code.dev/lease-expires-at': EXPIRY,
                      't3code.dev/expiry-enforced': 'false',
                      't3code.dev/retention': 'retain-until-owner-decision'}},
      'status': {'phase': 'Active'}}
PVC = {'kind': 'PersistentVolumeClaim', 'metadata': {
       'name': 't3-worker-data', 'namespace': NAMESPACE,
       'uid': '22222222-aaaa-bbbb-cccc-222222222222'},
       'spec': {'accessModes': ['ReadWriteOnce'],
                'resources': {'requests': {'storage': '10Gi'}},
                'volumeName': 'pvc-22222222-aaaa-bbbb-cccc-222222222222'},
       'status': {'phase': 'Bound'}}

DEPLOYMENT = {'kind': 'Deployment', 'metadata': {
       'name': 't3-worker', 'namespace': NAMESPACE,
       'uid': '44444444-aaaa-bbbb-cccc-444444444444', 'generation': 2},
       'spec': {'replicas': 1, 'strategy': {'type': 'Recreate'},
                'selector': {'matchLabels': {'app': 't3-worker'}},
                'template': {'metadata': {'labels': {'app': 't3-worker'}},
                             'spec': {'serviceAccountName': 't3-worker',
                                      'automountServiceAccountToken': False,
                                      'containers': [{'name': 't3', 'image': PLAN['image'],
                                          'volumeMounts': [
                                              {'name': 'data', 'mountPath': '/data'},
                                              {'name': 'tmp', 'mountPath': '/tmp'}]}],
                                      'volumes': [
                                          {'name': 'data', 'persistentVolumeClaim': {
                                              'claimName': 't3-worker-data'}},
                                          {'name': 'tmp', 'emptyDir': {'sizeLimit': '1Gi'}}]}}}}


_POD = DEPLOYMENT['spec']['template']['spec']
_POD.update({
    'hostname': 't3-worker', 'terminationGracePeriodSeconds': 90,
    'securityContext': {
        'runAsNonRoot': True, 'runAsUser': 10001, 'runAsGroup': 10001,
        'fsGroup': 10001, 'seccompProfile': {'type': 'RuntimeDefault'},
    },
})
_CONTAINER = _POD['containers'][0]
_CONTAINER.update({
    'workingDir': '/data', 'imagePullPolicy': 'IfNotPresent',
    'ports': [{'name': 'http', 'containerPort': 3773}],
    'resources': {
        'requests': {'cpu': '500m', 'memory': '1Gi', 'ephemeral-storage': '512Mi'},
        'limits': {'cpu': '2', 'memory': '4Gi', 'ephemeral-storage': '2Gi'},
    },
    'securityContext': {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
                        'capabilities': {'drop': ['ALL']}},
    'startupProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5,
                     'failureThreshold': 60},
    'readinessProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5},
})



class ObserveTests(unittest.TestCase):
    def test_stable_namespace_and_pvc_uid(self):
        initial = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        self.assertEqual(initial['pvcUID'], PVC['metadata']['uid'])
        p.compare(p.inspect(copy.deepcopy(PLAN), copy.deepcopy(NS), copy.deepcopy(PVC), copy.deepcopy(DEPLOYMENT)), initial)
        self.assertNotIn('image', initial)
        self.assertNotIn('credentials', json.dumps(initial))

    def test_generation_blocks_stale_same_uid_binding(self):
        original = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        self.assertEqual(original['deploymentGeneration'], 2)
        changed = copy.deepcopy(DEPLOYMENT)
        changed['metadata']['generation'] = 3  # Kubernetes spec mutation preserves UID.
        with self.assertRaisesRegex(p.ObservationError, 'binding changed'):
            p.compare(p.inspect(PLAN, NS, PVC, changed), original)
        for invalid in (None, 0, -1, True, '2'):
            bad = copy.deepcopy(DEPLOYMENT)
            bad['metadata']['generation'] = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(
                    p.ObservationError, 'generation'):
                p.inspect(PLAN, NS, PVC, bad)

    def test_wrong_lease_identity_or_namespace_is_rejected(self):
        for item, change in [('ns', {'metadata': {'name': 'other'}}),
                             ('plan', {'namespace': 'different'}),
                             ('plan', {'leaseHash': 'x' * 64})]:
            with self.subTest(item=item), self.assertRaises(p.ObservationError):
                parts = [copy.deepcopy(PLAN), copy.deepcopy(NS), copy.deepcopy(PVC), copy.deepcopy(DEPLOYMENT)]
                target = {'plan': 0, 'ns': 1}[item]
                parts[target].update(change)
                p.inspect(*parts)

    def test_missing_uid_and_binding_replacement_fail(self):
        for obj in ('ns', 'pvc'):
            parts = [copy.deepcopy(PLAN), copy.deepcopy(NS), copy.deepcopy(PVC), copy.deepcopy(DEPLOYMENT)]
            parts[1 if obj == 'ns' else 2]['metadata']['uid'] = ''
            with self.subTest(obj=obj), self.assertRaises(p.ObservationError):
                p.inspect(*parts)
        baseline = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        replaced = copy.deepcopy(PVC)
        replaced['metadata']['uid'] = '33333333-aaaa-bbbb-cccc-333333333333'
        with self.assertRaisesRegex(p.ObservationError, 'binding changed'):
            p.compare(p.inspect(PLAN, NS, replaced, DEPLOYMENT), baseline)

    def test_unbound_deleting_or_unsafe_claim_is_rejected(self):
        for path, value in [(('status', 'phase'), 'Pending'),
                            (('metadata', 'deletionTimestamp'), '2026-10-28T01:00:00Z'),
                            (('spec', 'accessModes'), ['ReadWriteMany']),
                            (('spec', 'volumeName'), '')]:
            with self.subTest(path=path):
                bad = copy.deepcopy(PVC)
                bad[path[0]][path[1]] = value
                with self.assertRaises(p.ObservationError):
                    p.inspect(PLAN, NS, bad, DEPLOYMENT)

    def test_namespace_annotation_or_policy_drift_fails(self):
        for key, value in [('t3code.dev/lease-key-sha256', 'b' * 64),
                           ('t3code.dev/expiry-enforced', 'true'),
                           ('t3code.dev/retention', 'delete')]:
            with self.subTest(key=key):
                bad = copy.deepcopy(NS)
                bad['metadata']['annotations'][key] = value
                with self.assertRaises(p.ObservationError):
                    p.inspect(PLAN, bad, PVC, DEPLOYMENT)
        deleted = copy.deepcopy(NS)
        deleted['metadata']['deletionTimestamp'] = '2026-10-28T01:00:00Z'
        with self.assertRaises(p.ObservationError):
            p.inspect(PLAN, deleted, PVC, DEPLOYMENT)

    def test_changed_pinned_image_invalidates_existing_binding(self):
        first = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        self.assertEqual(first['format'], 't3-k3s-p1-binding-v4')
        self.assertEqual(len(first['imageRefSha256']), 64)
        self.assertNotIn(PLAN['image'], json.dumps(first))
        changed = copy.deepcopy(PLAN)
        changed['image'] = 'ghcr.io/owned/other@sha256:' + 'c' * 64
        redeployed = copy.deepcopy(DEPLOYMENT)
        redeployed['spec']['template']['spec']['containers'][0]['image'] = changed['image']
        later = p.inspect(changed, NS, PVC, redeployed)
        self.assertNotEqual(first['imageRefSha256'], later['imageRefSha256'])
        with self.assertRaisesRegex(p.ObservationError, 'binding changed'):
            p.compare(later, first)

    def test_invalid_image_and_legacy_binding_are_rejected(self):
        for image in (None, 't3:latest', 'ghcr.io/owned/t3-worker:latest',
                      'ghcr.io/owned/t3-worker@sha256:' + 'Z' * 64,
                      'ghcr.io/owned/../other@sha256:' + 'a' * 64,
                      'ghcr.io//owned/t3@sha256:' + 'a' * 64):
            with self.subTest(image=image), self.assertRaisesRegex(
                    p.ObservationError, 'immutable image'):
                bad = copy.deepcopy(PLAN)
                bad['image'] = image
                p.inspect(bad, NS, PVC, DEPLOYMENT)
        current = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        legacy = dict(current, format='t3-k3s-p1-binding-v1')
        legacy.pop('imageRefSha256')
        with self.assertRaisesRegex(p.ObservationError, 'binding changed'):
            p.compare(current, legacy)


    def test_observed_deployment_image_must_match_plan(self):
        first = p.inspect(PLAN, NS, PVC, DEPLOYMENT)
        self.assertEqual(first['deploymentUID'], DEPLOYMENT['metadata']['uid'])
        for image in ('ghcr.io/other/t3@sha256:' + 'c' * 64, 't3:latest'):
            bad = copy.deepcopy(DEPLOYMENT)
            bad['spec']['template']['spec']['containers'][0]['image'] = image
            with self.subTest(image=image), self.assertRaisesRegex(
                    p.ObservationError, 'observed deployment image'):
                p.inspect(PLAN, NS, PVC, bad)

    def test_deployment_identity_and_pvc_mount_drift_fail_closed(self):
        mutations = [
            ('namespace', ('metadata', 'namespace'), 'another'),
            ('uid', ('metadata', 'uid'), ''),
            ('replicas', ('spec', 'replicas'), 2),
            ('strategy', ('spec', 'strategy'), {'type': 'RollingUpdate'}),
            ('selector', ('spec', 'selector'), {'matchLabels': {'app': 'other'}}),
            ('labels', ('spec', 'template', 'metadata', 'labels'), {'app': 'other'}),
            ('sa', ('spec', 'template', 'spec', 'serviceAccountName'), 'default'),
            ('token', ('spec', 'template', 'spec', 'automountServiceAccountToken'), True),
            ('volume', ('spec', 'template', 'spec', 'volumes'), [
                {'name': 'data', 'hostPath': {'path': '/host'}},
                {'name': 'tmp', 'emptyDir': {'sizeLimit': '1Gi'}}]),
            ('mount', ('spec', 'template', 'spec', 'containers'), [
                {'name': 't3', 'image': PLAN['image'], 'volumeMounts': [
                    {'name': 'data', 'mountPath': '/home'}, {'name': 'tmp', 'mountPath': '/tmp'}]}]),
        ]
        for label, path, value in mutations:
            bad = copy.deepcopy(DEPLOYMENT)
            target = bad
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(label=label), self.assertRaises(p.ObservationError):
                p.inspect(PLAN, NS, PVC, bad)
        replaced = copy.deepcopy(DEPLOYMENT)
        replaced['metadata']['uid'] = '55555555-aaaa-bbbb-cccc-555555555555'
        with self.assertRaisesRegex(p.ObservationError, 'binding changed'):
            p.compare(p.inspect(PLAN, NS, PVC, replaced),
                      p.inspect(PLAN, NS, PVC, DEPLOYMENT))

    def test_expected_kubernetes_api_defaults_do_not_false_reject(self):
        defaulted = copy.deepcopy(DEPLOYMENT)
        container = defaulted['spec']['template']['spec']['containers'][0]
        container['ports'][0]['protocol'] = 'TCP'
        for probe_name, failure_threshold in (('startupProbe', 60), ('readinessProbe', 3)):
            container[probe_name].update({
                'failureThreshold': failure_threshold, 'timeoutSeconds': 1,
                'successThreshold': 1, 'initialDelaySeconds': 0,
            })
        p.compare(p.inspect(PLAN, NS, PVC, defaulted),
                  p.inspect(PLAN, NS, PVC, DEPLOYMENT))
        container['ports'][0]['hostPort'] = 3773
        with self.assertRaises(p.ObservationError):
            p.inspect(PLAN, NS, PVC, defaulted)

    def test_privilege_network_and_credential_injection_fail_closed(self):
        changes = [
            ('host-network', ('hostNetwork',), True),
            ('host-pid', ('hostPID',), True),
            ('host-ipc', ('hostIPC',), True),
            ('sidecar', ('initContainers',), [{'name': 'other', 'image': PLAN['image']}]),
            ('registry-secret', ('imagePullSecrets',), [{'name': 'secret'}]),
            ('hostname', ('hostname',), 'other'),
            ('pod-security', ('securityContext', 'runAsNonRoot'), False),
            ('pod-seccomp', ('securityContext', 'seccompProfile'), {'type': 'Unconfined'}),
            ('env-secret', ('containers', 0, 'envFrom'), [{'secretRef': {'name': 'secret'}}]),
            ('shell-override', ('containers', 0, 'command'), ['/bin/sh']),
            ('privileged', ('containers', 0, 'securityContext', 'privileged'), True),
            ('container-root', ('containers', 0, 'securityContext', 'runAsUser'), 0),
            ('container-seccomp', ('containers', 0, 'securityContext', 'seccompProfile'),
             {'type': 'Unconfined'}),
            ('container-procmount', ('containers', 0, 'securityContext', 'procMount'),
             'Unmasked'),
            ('escalation', ('containers', 0, 'securityContext', 'allowPrivilegeEscalation'), True),
            ('filesystem', ('containers', 0, 'securityContext', 'readOnlyRootFilesystem'), False),
            ('caps', ('containers', 0, 'securityContext', 'capabilities'), {'drop': []}),
            ('cpu', ('containers', 0, 'resources', 'limits', 'cpu'), '8'),
            ('readiness', ('containers', 0, 'readinessProbe', 'tcpSocket', 'port'), 9999),
        ]
        for label, path, value in changes:
            bad = copy.deepcopy(DEPLOYMENT)
            target = bad['spec']['template']['spec']
            for segment in path[:-1]:
                target = target[segment]
            target[path[-1]] = value
            with self.subTest(label=label), self.assertRaises(p.ObservationError):
                p.inspect(PLAN, NS, PVC, bad)

    def test_missing_required_security_fields_fail_closed(self):
        for path in [
            ('securityContext',),
            ('containers', 0, 'securityContext'),
            ('containers', 0, 'resources'),
            ('containers', 0, 'startupProbe'),
        ]:
            bad = copy.deepcopy(DEPLOYMENT)
            target = bad['spec']['template']['spec']
            for segment in path[:-1]:
                target = target[segment]
            del target[path[-1]]
            with self.subTest(path=path), self.assertRaises(p.ObservationError):
                p.inspect(PLAN, NS, PVC, bad)

    def test_cli_rejects_invalid_binding_without_emitting_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ('plan.json', 'ns.json', 'pvc.json', 'deployment.json')]
            for path, value in zip(paths, (PLAN, NS, PVC, DEPLOYMENT)):
                path.write_text(json.dumps(value))
            argv = [sys.executable, str(HERE / 'observe.py'), '--plan', str(paths[0]),
                    '--namespace', str(paths[1]), '--pvc', str(paths[2]),
                    '--deployment', str(paths[3])]
            first = subprocess.run(argv, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stderr)
            baseline = Path(directory) / 'binding.json'
            baseline.write_text(first.stdout)
            okay = subprocess.run(argv + ['--baseline', str(baseline)], capture_output=True,
                                  text=True, check=False)
            self.assertEqual(okay.returncode, 0)
            altered = copy.deepcopy(PVC)
            altered['metadata']['uid'] = '33333333-aaaa-bbbb-cccc-333333333333'
            paths[2].write_text(json.dumps(altered))
            rejected = subprocess.run(argv + ['--baseline', str(baseline)], capture_output=True,
                                      text=True, check=False)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(rejected.stdout, '')
            self.assertNotIn(altered['metadata']['uid'], rejected.stderr)


    def test_invalid_calendar_dates_and_planning_bounds_fail_closed(self):
        for expiry in ('2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
                       '2019-12-31T23:59:59Z', '2101-01-01T00:00:00Z'):
            bad = copy.deepcopy(PLAN)
            bad['expiresAt'] = expiry
            with self.subTest(expiry=expiry), self.assertRaises(p.ObservationError):
                p.inspect(bad, NS, PVC, DEPLOYMENT)

    def test_malformed_nested_api_json_fails_without_raw_traceback(self):
        cases = [
            ('namespace-metadata', 1, ('metadata',), None),
            ('namespace-status', 1, ('status',), []),
            ('pvc-spec', 2, ('spec',), None),
            ('pvc-requests', 2, ('spec', 'resources', 'requests'), []),
            ('deployment-spec', 3, ('spec',), None),
            ('deployment-selector', 3, ('spec', 'selector'), None),
            ('deployment-pod', 3, ('spec', 'template', 'spec'), []),
        ]
        for label, index, path, value in cases:
            parts = [copy.deepcopy(x) for x in (PLAN, NS, PVC, DEPLOYMENT)]
            target = parts[index]
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.subTest(label=label), self.assertRaisesRegex(
                    p.ObservationError, 'malformed JSON object'):
                p.inspect(*parts)

        with tempfile.TemporaryDirectory() as directory:
            documents = [copy.deepcopy(x) for x in (PLAN, NS, PVC, DEPLOYMENT)]
            documents[1]['metadata'] = None
            paths = [Path(directory) / name for name in
                     ('plan.json', 'namespace.json', 'pvc.json', 'deployment.json')]
            for path, doc in zip(paths, documents):
                path.write_text(json.dumps(doc), encoding='utf-8')
            args = [sys.executable, str(HERE / 'observe.py')]
            for key, path in zip(('plan', 'namespace', 'pvc', 'deployment'), paths):
                args.extend((f'--{key}', str(path)))
            result = subprocess.run(args, capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertNotIn('Traceback', result.stderr)
            self.assertNotIn(str(paths[1]), result.stderr)


if __name__ == '__main__':
    unittest.main()
