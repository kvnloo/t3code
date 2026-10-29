#!/usr/bin/env python3
"""P1 offline binding check: Namespace, PVC and desired Deployment; no K8s calls.

A matching Kubernetes snapshot is NOT worker readiness, T3 identity, peer
consent, a task completion, or a license to apply/delete any resources.
"""

import argparse
import hashlib
import json
from pathlib import Path
from datetime import datetime
import re


class ObservationError(ValueError):
    """Observation cannot be bound safely to the immutable lease plan."""


def _require(value, expected, label):
    if value != expected:
        raise ObservationError(f'{label} does not match lease plan')


def _uid(obj, label):
    value = obj.get('metadata', {}).get('uid')
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9-]{8,128}', value):
        raise ObservationError(f'{label} lacks a valid Kubernetes UID')
    return value


def _inspect(plan, namespace, pvc, deployment):
    """Verify immutable lease identity and bound storage from API JSON objects.

    Inputs must be collected from one explicitly approved Kubernetes context.
    This does not contact or attest that context; it also cannot prove PVC
    contents, live Pod ownership, TLS, peer OAuth, or CNI enforcement.
    """
    if not all(isinstance(x, dict) for x in (plan, namespace, pvc, deployment)):
        raise ObservationError('expected JSON objects')
    lease_hash = plan.get('leaseHash')
    if not isinstance(lease_hash, str) or not re.fullmatch('[0-9a-f]{64}', lease_hash):
        raise ObservationError('invalid lease hash')
    name = 't3-p1-' + lease_hash[:24]
    _require(plan.get('format'), 't3-k3s-p1-plan-v1', 'plan version')
    _require(plan.get('namespace'), name, 'planned namespace')
    _require(plan.get('retention'), 'retain', 'planned retention')
    expiry = plan.get('expiresAt')
    if not isinstance(expiry, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', expiry):
        raise ObservationError('invalid lease expiry')
    try:
        expiry_date = datetime.strptime(expiry, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError as exc:
        raise ObservationError('invalid lease expiration calendar date') from exc
    if expiry_date.year < 2020 or expiry_date.year > 2100:
        raise ObservationError('lease expiration is outside planning bounds')
    # A stable Namespace/PVC is not enough: the same key must not silently
    # rebind to a different image. Hash the *whole* pinned reference so the
    # private binding receipt never exposes the registry or image name.
    image = plan.get('image')
    if (not isinstance(image, str) or not re.fullmatch(
            r'(?=.{1,255}$)[a-z0-9][a-z0-9._:/-]*/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}', image)
            or '..' in image or '//' in image):
        raise ObservationError('invalid immutable image reference')

    # v3 binds the actual observed Deployment's *desired template* to the
    # immutable plan. v2 hashed the plan alone and could miss image drift in
    # Kubernetes. This still says nothing about which image a live Pod runs.
    _require(deployment.get('kind'), 'Deployment', 'deployment kind')
    dmeta = deployment.get('metadata', {})
    _require(dmeta.get('name'), 't3-worker', 'deployment name')
    _require(dmeta.get('namespace'), name, 'deployment namespace')
    if dmeta.get('deletionTimestamp'):
        raise ObservationError('deployment is deleting')
    deployment_uid = _uid(deployment, 'deployment')
    dspec = deployment.get('spec', {})
    _require(dspec.get('replicas'), 1, 'deployment replicas')
    _require(dspec.get('strategy', {}).get('type'), 'Recreate', 'deployment strategy')
    expected_labels = {'app': 't3-worker'}
    _require(dspec.get('selector', {}).get('matchLabels'), expected_labels, 'deployment selector')
    template = dspec.get('template', {})
    _require(template.get('metadata', {}).get('labels'), expected_labels, 'deployment Pod labels')
    pod = template.get('spec', {})
    _require(pod.get('serviceAccountName'), 't3-worker', 'deployment ServiceAccount')
    _require(pod.get('automountServiceAccountToken'), False, 'deployment API token')
    containers = pod.get('containers')
    if not isinstance(containers, list) or len(containers) != 1 or not isinstance(containers[0], dict):
        raise ObservationError('deployment must have exactly one T3 container')
    container = containers[0]
    _require(container.get('name'), 't3', 'deployment container')
    _require(container.get('image'), image, 'observed deployment image')
    # Fail closed if the observed desired Pod loosens its isolation while
    # retaining the same Deployment UID, image, ServiceAccount and PVC.
    # These checks cover spec drift, not admission/CNI enforcement or live Pods.
    _require(pod.get('hostname'), 't3-worker', 'deployment hostname')
    _require(pod.get('terminationGracePeriodSeconds'), 90, 'deployment termination grace')
    _require(pod.get('securityContext'), {
        'runAsNonRoot': True, 'runAsUser': 10001, 'runAsGroup': 10001,
        'fsGroup': 10001, 'seccompProfile': {'type': 'RuntimeDefault'},
    }, 'deployment Pod security')
    for field in ('hostNetwork', 'hostPID', 'hostIPC', 'shareProcessNamespace'):
        if pod.get(field) not in (None, False):
            raise ObservationError('deployment host isolation drift')
    for field in ('initContainers', 'ephemeralContainers', 'imagePullSecrets',
                  'hostAliases'):
        if pod.get(field):
            raise ObservationError('deployment unexpected Pod credential or container path')
    _require(container.get('workingDir'), '/data', 'deployment working directory')
    _require(container.get('imagePullPolicy'), 'IfNotPresent', 'deployment pull policy')
    # Kubernetes defaults protocol=TCP in the observed object, even when
    # omitted from the manifest. Accept that default but never hostPorts.
    ports = container.get('ports')
    if not isinstance(ports, list) or len(ports) != 1 or not isinstance(ports[0], dict):
        raise ObservationError('deployment HTTP port shape changed')
    _require(ports[0].get('name'), 'http', 'deployment HTTP port name')
    _require(ports[0].get('containerPort'), 3773, 'deployment HTTP port')
    _require(ports[0].get('protocol', 'TCP'), 'TCP', 'deployment HTTP protocol')
    if ports[0].get('hostPort') not in (None, 0) or ports[0].get('hostIP'):
        raise ObservationError('deployment host port is forbidden')
    _require(container.get('resources'), {
        'requests': {'cpu': '500m', 'memory': '1Gi', 'ephemeral-storage': '512Mi'},
        'limits': {'cpu': '2', 'memory': '4Gi', 'ephemeral-storage': '2Gi'},
    }, 'deployment resource bounds')
    security = container.get('securityContext')
    if not isinstance(security, dict):
        raise ObservationError('deployment missing container security context')
    for field, value in {
        'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
        'capabilities': {'drop': ['ALL']},
    }.items():
        _require(security.get(field), value, 'deployment container security')
    if security.get('privileged') not in (None, False):
        raise ObservationError('deployment privileged container')
    # Container-level overrides take precedence over Pod securityContext.
    # Only allow safe equivalent defaults; unknown keys fail closed.
    allowed = {'allowPrivilegeEscalation', 'readOnlyRootFilesystem',
               'capabilities', 'privileged', 'runAsNonRoot', 'runAsUser',
               'runAsGroup', 'seccompProfile'}
    if set(security) - allowed:
        raise ObservationError('deployment unexpected container security override')
    for field, expected in {
        'runAsNonRoot': True, 'runAsUser': 10001, 'runAsGroup': 10001,
        'seccompProfile': {'type': 'RuntimeDefault'},
    }.items():
        if field in security:
            _require(security[field], expected, 'deployment container security override')
    for field in ('env', 'envFrom', 'command', 'args', 'lifecycle', 'volumeDevices'):
        if container.get(field):
            raise ObservationError('deployment unexpected injected container configuration')
    # Kubernetes may add probe defaults to fetched API JSON.
    for probe_name, failures in (('startupProbe', 60), ('readinessProbe', 3)):
        probe = container.get(probe_name)
        if not isinstance(probe, dict):
            raise ObservationError('deployment probe missing')
        _require(probe.get('tcpSocket'), {'port': 'http'}, 'deployment probe target')
        _require(probe.get('periodSeconds'), 5, 'deployment probe frequency')
        _require(probe.get('failureThreshold', 3), failures, 'deployment probe failures')
        _require(probe.get('timeoutSeconds', 1), 1, 'deployment probe timeout')
        _require(probe.get('successThreshold', 1), 1, 'deployment probe successes')
        _require(probe.get('initialDelaySeconds', 0), 0, 'deployment probe initial delay')
        if any(key not in {
            'tcpSocket', 'periodSeconds', 'failureThreshold', 'timeoutSeconds',
            'successThreshold', 'initialDelaySeconds',
        } for key in probe):
            raise ObservationError('deployment unexpected probe configuration')
    _require(container.get('volumeMounts'), [
        {'name': 'data', 'mountPath': '/data'},
        {'name': 'tmp', 'mountPath': '/tmp'},
    ], 'deployment volume mounts')
    _require(pod.get('volumes'), [
        {'name': 'data', 'persistentVolumeClaim': {'claimName': 't3-worker-data'}},
        {'name': 'tmp', 'emptyDir': {'sizeLimit': '1Gi'}},
    ], 'deployment volumes')

    _require(namespace.get('kind'), 'Namespace', 'namespace kind')
    nmeta = namespace.get('metadata', {})
    _require(nmeta.get('name'), name, 'namespace name')
    _require(namespace.get('status', {}).get('phase'), 'Active', 'namespace phase')
    if nmeta.get('deletionTimestamp'):
        raise ObservationError('namespace is deleting')
    labels = nmeta.get('labels', {})
    _require(labels.get('pod-security.kubernetes.io/enforce'), 'restricted', 'Pod Security')
    annotations = nmeta.get('annotations', {})
    _require(annotations.get('t3code.dev/lease-key-sha256'), lease_hash, 'namespace lease')
    _require(annotations.get('t3code.dev/lease-expires-at'), expiry, 'namespace expiry')
    _require(annotations.get('t3code.dev/expiry-enforced'), 'false', 'TTL disclaimer')
    _require(annotations.get('t3code.dev/retention'), 'retain-until-owner-decision', 'PVC retention')

    _require(pvc.get('kind'), 'PersistentVolumeClaim', 'PVC kind')
    pmeta = pvc.get('metadata', {})
    _require(pmeta.get('name'), 't3-worker-data', 'PVC name')
    _require(pmeta.get('namespace'), name, 'PVC namespace')
    if pmeta.get('deletionTimestamp'):
        raise ObservationError('PVC is deleting')
    _require(pvc.get('status', {}).get('phase'), 'Bound', 'PVC phase')
    pspec = pvc.get('spec', {})
    _require(pspec.get('accessModes'), ['ReadWriteOnce'], 'PVC access mode')
    _require(pspec.get('resources', {}).get('requests', {}).get('storage'), '10Gi', 'PVC request')
    volume = pspec.get('volumeName')
    if not isinstance(volume, str) or not volume or len(volume) > 253:
        raise ObservationError('PVC has no bound PersistentVolume name')

    return {'format': 't3-k3s-p1-binding-v3', 'leaseHash': lease_hash,
            'namespace': name, 'namespaceUID': _uid(namespace, 'namespace'),
            'pvcUID': _uid(pvc, 'PVC'), 'deploymentUID': deployment_uid,
            'volumeName': volume,
            'imageRefSha256': hashlib.sha256(image.encode('ascii')).hexdigest(),
            'expiresAt': expiry, 'retention': 'retain'}


def inspect(plan, namespace, pvc, deployment):
    """Treat malformed API JSON as a failed binding, without leaking details."""
    try:
        return _inspect(plan, namespace, pvc, deployment)
    except (AttributeError, KeyError, TypeError) as exc:
        # Fetched Kubernetes objects may contain unexpected null/list values.
        # Never let a malformed snapshot escape as an unhandled traceback.
        raise ObservationError('malformed JSON object in P1 binding observation') from exc


def compare(current, baseline):
    if not isinstance(baseline, dict) or current != baseline:
        raise ObservationError('binding changed: refuse to resume or accept a worker')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True, help='private immutable lease-plan receipt')
    parser.add_argument('--namespace', type=Path, required=True, help='kubectl get namespace -o json')
    parser.add_argument('--pvc', type=Path, required=True, help='kubectl get pvc -o json')
    parser.add_argument('--deployment', type=Path, required=True,
                        help='kubectl get deployment t3-worker -o json')
    parser.add_argument('--baseline', type=Path, help='previously verified private binding JSON')
    args = parser.parse_args()
    try:
        documents = [json.loads(path.read_text(encoding='utf-8'))
                     for path in (args.plan, args.namespace, args.pvc, args.deployment)]
        binding = inspect(*documents)
        if args.baseline is not None:
            compare(binding, json.loads(args.baseline.read_text(encoding='utf-8')))
    except (OSError, json.JSONDecodeError, ObservationError) as exc:
        # Avoid echoing object contents or OS errors with private host paths.
        parser.exit(1, f'FAIL: P1 lease/PVC binding could not be verified ({type(exc).__name__})\n')
    print(json.dumps(binding, sort_keys=True))
    print('DESIRED-SPEC BINDING ONLY: NOT live Pod image, readiness, HTTPS, OAuth or delegation proof', file=__import__('sys').stderr)


if __name__ == '__main__':
    main()
