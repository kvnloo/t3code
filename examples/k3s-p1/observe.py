#!/usr/bin/env python3
"""P1 offline binding check: observed Namespace and PVC UIDs, no K8s calls.

A matching Kubernetes snapshot is NOT worker readiness, T3 identity, peer
consent, a task completion, or a license to apply/delete any resources.
"""

import argparse
import hashlib
import json
from pathlib import Path
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


def inspect(plan, namespace, pvc):
    """Verify immutable lease identity and bound storage from API JSON objects.

    Inputs must be collected from one explicitly approved Kubernetes context.
    This does not contact or attest that context; it also cannot prove PVC
    contents, live Pod ownership, TLS, peer OAuth, or CNI enforcement.
    """
    if not all(isinstance(x, dict) for x in (plan, namespace, pvc)):
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
    # A stable Namespace/PVC is not enough: the same key must not silently
    # rebind to a different image. Hash the *whole* pinned reference so the
    # private binding receipt never exposes the registry or image name.
    image = plan.get('image')
    if (not isinstance(image, str) or not re.fullmatch(
            r'(?=.{1,255}$)[a-z0-9][a-z0-9._:/-]*/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}', image)
            or '..' in image or '//' in image):
        raise ObservationError('invalid immutable image reference')

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

    return {'format': 't3-k3s-p1-binding-v2', 'leaseHash': lease_hash,
            'namespace': name, 'namespaceUID': _uid(namespace, 'namespace'),
            'pvcUID': _uid(pvc, 'PVC'), 'volumeName': volume,
            'imageRefSha256': hashlib.sha256(image.encode('ascii')).hexdigest(),
            'expiresAt': expiry, 'retention': 'retain'}


def compare(current, baseline):
    if not isinstance(baseline, dict) or current != baseline:
        raise ObservationError('binding changed: refuse to resume or accept a worker')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True, help='private immutable lease-plan receipt')
    parser.add_argument('--namespace', type=Path, required=True, help='kubectl get namespace -o json')
    parser.add_argument('--pvc', type=Path, required=True, help='kubectl get pvc -o json')
    parser.add_argument('--baseline', type=Path, help='previously verified private binding JSON')
    args = parser.parse_args()
    try:
        documents = [json.loads(path.read_text(encoding='utf-8'))
                     for path in (args.plan, args.namespace, args.pvc)]
        binding = inspect(*documents)
        if args.baseline is not None:
            compare(binding, json.loads(args.baseline.read_text(encoding='utf-8')))
    except (OSError, json.JSONDecodeError, ObservationError) as exc:
        # Avoid echoing object contents or OS errors with private host paths.
        parser.exit(1, f'FAIL: P1 lease/PVC binding could not be verified ({type(exc).__name__})\n')
    print(json.dumps(binding, sort_keys=True))
    print('UID BINDING ONLY: NOT worker readiness, HTTPS, OAuth or delegation proof', file=__import__('sys').stderr)


if __name__ == '__main__':
    main()
