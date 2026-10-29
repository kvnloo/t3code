"""Read-only adversarial snapshot regressions; no kubeconfig or credentials."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('pod_check', HERE / 'pod_check.py')
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)

HASH = 'a' * 64
NS = 't3-p1-' + HASH[:24]
IMAGE = 'ghcr.io/example/t3@sha256:' + 'b' * 64
DUID = '11111111-1111-4111-8111-111111111111'
RUID = '22222222-2222-4222-8222-222222222222'
PUID = '33333333-3333-4333-8333-333333333333'
PLAN = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': HASH, 'namespace': NS, 'image': IMAGE}
BINDING = {'format': 't3-k3s-p1-binding-v4', 'leaseHash': HASH, 'namespace': NS,
           'deploymentUID': DUID, 'deploymentGeneration': 2, 'imageRefSha256': hashlib.sha256(IMAGE.encode()).hexdigest()}
CONTAINER = {'name': 't3', 'image': IMAGE, 'workingDir': '/data',
             'imagePullPolicy': 'IfNotPresent',
             'ports': [{'name': 'http', 'containerPort': 3773}],
             'startupProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5,
                              'failureThreshold': 60},
             'readinessProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5},
             'securityContext': {'readOnlyRootFilesystem': True},
             'resources': {'limits': {'memory': '4Gi'}},
             'volumeMounts': [{'name': 'data', 'mountPath': '/data'}]}
PODSPEC = {'serviceAccountName': 't3-worker', 'automountServiceAccountToken': False,
           'securityContext': {'runAsNonRoot': True},
           'volumes': [{'name': 'data', 'persistentVolumeClaim': {'claimName': 't3-worker-data'}}],
           'containers': [copy.deepcopy(CONTAINER)]}
D = {'kind': 'Deployment', 'metadata': {'name': 't3-worker', 'uid': DUID,
     'namespace': NS, 'generation': 2},
     'spec': {'template': {'spec': copy.deepcopy(PODSPEC)}},
     'status': {'observedGeneration': 2, 'replicas': 1, 'readyReplicas': 1,
                'availableReplicas': 1, 'updatedReplicas': 1}}
RS = {'kind': 'ReplicaSet', 'metadata': {'name': 't3-worker-abcdef', 'uid': RUID,
      'namespace': NS, 'ownerReferences': [{'kind': 'Deployment', 'name': 't3-worker',
                                           'uid': DUID, 'controller': True}]},
      'spec': {'replicas': 1}, 'status': {'readyReplicas': 1, 'replicas': 1}}
POD = {'kind': 'Pod', 'metadata': {'name': 't3-worker-abcdef-0123', 'namespace': NS,
       'uid': PUID, 'labels': {'app': 't3-worker'}, 'ownerReferences': [
           {'kind': 'ReplicaSet', 'name': RS['metadata']['name'], 'uid': RUID,
            'controller': True}]}, 'spec': copy.deepcopy(PODSPEC),
       'status': {'phase': 'Running', 'conditions': [{'type': 'Ready', 'status': 'True'}],
                  'containerStatuses': [{'name': 't3', 'ready': True, 'started': True,
                  'state': {'running': {'startedAt': '2026-10-29T00:00:00Z'}},
                  'image': IMAGE, 'imageID': 'docker-pullable://example@sha256:' + 'c' * 64,
                  'containerID': 'containerd://' + 'd' * 64, 'restartCount': 0}]}}
RS_LIST = {'kind': 'ReplicaSetList', 'items': [RS]}
PODS = {'kind': 'PodList', 'items': [POD]}


def fixture():
    return copy.deepcopy([PLAN, BINDING, D, RS_LIST, PODS])


class RuntimeTests(unittest.TestCase):
    def test_binds_single_running_pod_without_exposing_image(self):
        result = pc.inspect(*fixture())
        self.assertEqual(result['podUID'], PUID)
        self.assertEqual(result['deploymentUID'], DUID)
        self.assertEqual(result['restartCount'], 0)
        self.assertNotIn(IMAGE, json.dumps(result))
        old = fixture()
        old[3]['items'].append({'kind': 'ReplicaSet', 'metadata': {'name': 't3-worker-old',
                   'uid': '44444444-4444-4444-4444-444444444444', 'namespace': NS,
                   'ownerReferences': RS['metadata']['ownerReferences']},
                   'spec': {'replicas': 0}, 'status': {'replicas': 0}})
        pc.inspect(*old)  # Kubernetes can retain an inactive revision.

    def test_reject_ownership_or_lease_rebinding(self):
        for idx, path, value in [
            (1, ('deploymentUID',), 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
            (1, ('deploymentGeneration',), 1),
            (1, ('imageRefSha256',), '0' * 64),
            (2, ('metadata', 'uid'), 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
            (3, ('items', 0, 'metadata', 'ownerReferences', 0, 'controller'), False),
            (4, ('items', 0, 'metadata', 'ownerReferences', 0, 'uid'), 'fake'),
            (4, ('items', 0, 'metadata', 'namespace'), 'other'),
        ]:
            args = fixture()
            v = args[idx]
            for key in path[:-1]:
                v = v[key]
            v[path[-1]] = value
            with self.subTest(idx=idx, path=path), self.assertRaises(pc.PodError):
                pc.inspect(*args)

    def test_reject_spec_change_between_binding_and_pod_read(self):
        args = fixture()
        args[2]['metadata']['generation'] = 3
        args[2]['status']['observedGeneration'] = 3
        # Same UID, image and ready replicas do not imply unchanged spec.
        with self.assertRaisesRegex(pc.PodError, 'deployment changed'):
            pc.inspect(*args)
        for bad in (None, 0, True, '2'):
            args = fixture()
            args[1]['deploymentGeneration'] = bad
            with self.subTest(bad=bad), self.assertRaises(pc.PodError):
                pc.inspect(*args)

    def test_reject_false_readiness_and_concurrent_pods(self):
        cases = [
            (2, ('status', 'observedGeneration'), 1),
            (2, ('status', 'readyReplicas'), 0),
            (3, ('items', 0, 'status', 'readyReplicas'), 0),
            (4, ('items', 0, 'status', 'phase'), 'Pending'),
            (4, ('items', 0, 'status', 'conditions', 0, 'status'), 'False'),
            (4, ('items', 0, 'status', 'containerStatuses', 0, 'ready'), False),
            (4, ('items', 0, 'status', 'containerStatuses', 0, 'state'), {'waiting': {}}),
            (4, ('items', 0, 'status', 'containerStatuses', 0, 'image'),
             'ghcr.io/example/other@sha256:' + 'b' * 64),
        ]
        for idx, path, value in cases:
            args = fixture()
            obj = args[idx]
            for key in path[:-1]:
                obj = obj[key]
            obj[path[-1]] = value
            with self.subTest(idx=idx, path=path), self.assertRaises(pc.PodError):
                pc.inspect(*args)
        args = fixture()
        args[4]['items'].append(copy.deepcopy(POD))
        with self.assertRaises(pc.PodError):
            pc.inspect(*args)

    def test_reject_mutated_pod_and_untrusted_snapshots(self):
        for path, value in [
            (('spec', 'automountServiceAccountToken'), True),
            (('spec', 'containers', 0, 'securityContext'), {'privileged': True}),
            (('spec', 'containers', 0, 'image'), 'different'),
            (('spec', 'volumes'), []),
            (('spec', 'initContainers'), [{'name': 'sidecar'}]),
            (('metadata', 'deletionTimestamp'), '2026-10-29T00:00:00Z'),
        ]:
            args = fixture()
            pod = args[4]['items'][0]
            for key in path[:-1]:
                pod = pod[key]
            pod[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(pc.PodError):
                pc.inspect(*args)
        for idx in range(5):
            args = fixture()
            args[idx] = None
            with self.subTest(idx=idx), self.assertRaises((pc.PodError, TypeError, AttributeError)):
                pc.inspect(*args)

    def test_reject_admitted_startup_and_network_drift(self):
        for path, value in [
            (('containers', 0, 'lifecycle'),
             {'postStart': {'exec': {'command': ['/bin/sh', '-c', 'true']}}}),
            (('containers', 0, 'ports', 0, 'hostPort'), 3773),
            (('containers', 0, 'ports', 0, 'containerPort'), 9876),
            (('containers', 0, 'startupProbe'),
             {'exec': {'command': ['/bin/sh']}, 'periodSeconds': 5,
              'failureThreshold': 60}),
            (('containers', 0, 'readinessProbe', 'tcpSocket', 'port'), 9876),
            (('containers', 0, 'workingDir'), '/tmp'),
            (('containers', 0, 'imagePullPolicy'), 'Always'),
            (('hostname',), 'unexpected-host'),
        ]:
            args = fixture()
            obj = args[4]['items'][0]['spec']
            for key in path[:-1]:
                obj = obj[key]
            obj[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(pc.PodError):
                pc.inspect(*args)

        args = fixture()
        admitted = args[4]['items'][0]['spec']['containers'][0]
        # Kubernetes fills omitted probe defaults and TCP protocol.
        admitted['ports'][0]['protocol'] = 'TCP'
        for probe in ('startupProbe', 'readinessProbe'):
            admitted[probe].update({'timeoutSeconds': 1, 'successThreshold': 1,
                                    'initialDelaySeconds': 0})
        admitted['readinessProbe']['failureThreshold'] = 3
        pc.inspect(*args)

    def test_cli_sanitizes_private_details(self):
        with tempfile.TemporaryDirectory() as d:
            paths = [Path(d) / name for name in ('plan', 'binding', 'deployment', 'replicasets', 'pods')]
            for f, obj in zip(paths, fixture()):
                f.write_text(json.dumps(obj))
            cmd = [sys.executable, str(HERE / 'pod_check.py')]
            for flag, path in zip(('plan', 'binding', 'deployment', 'replicasets', 'pods'), paths):
                cmd += ['--' + flag, str(path)]
            good = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertEqual(good.returncode, 0, good.stderr)
            self.assertIn('NOT RUN:', good.stdout)
            bad = copy.deepcopy(POD)
            bad['status']['containerStatuses'][0]['image'] = 'private.example/secret'
            paths[4].write_text(json.dumps({'kind': 'PodList', 'items': [bad]}))
            failed = subprocess.run(cmd, capture_output=True, text=True, check=False)
            self.assertNotEqual(failed.returncode, 0)
            self.assertNotIn('private.example', failed.stderr)
            self.assertNotIn(NS, failed.stderr)


if __name__ == '__main__':
    unittest.main()
