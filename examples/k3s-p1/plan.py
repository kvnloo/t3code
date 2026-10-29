#!/usr/bin/env python3
"""P1 preview: deterministic, fail-closed T3 worker plan, with NO cluster writes.

A stored local lease-plan is NOT a running lease: there is no Kubernetes apply,
lease renewal, expiry controller, peer OAuth grant, or T3 task submission here.
P0 live acceptance remains a prerequisite to any P1 rollout.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

import yaml

KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z")
IMAGE = re.compile(r"(?=.{1,255}$)[a-z0-9][a-z0-9._:/-]*/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}\Z")
UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\Z")


class PlanError(ValueError):
    """Invalid plan or conflicting immutable lease request."""


def build(lease_key: str, image: str, expires_at: str) -> tuple[dict, list[dict]]:
    if not isinstance(lease_key, str) or not KEY.fullmatch(lease_key) or '..' in lease_key:
        raise PlanError('lease key must be a stable, bounded opaque ASCII identifier')
    if not isinstance(image, str) or not IMAGE.fullmatch(image) or '..' in image or '//' in image:
        raise PlanError('image must use an immutable registry/repository@sha256 digest')
    if not isinstance(expires_at, str) or not UTC.fullmatch(expires_at):
        raise PlanError('expires-at must be an exact UTC timestamp YYYY-MM-DDTHH:MM:SSZ')
    try:
        timestamp = datetime.strptime(expires_at, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise PlanError('invalid UTC expiration timestamp') from exc
    if timestamp.year < 2020 or timestamp.year > 2100:
        raise PlanError('expiration outside supported planning bounds')

    full_hash = hashlib.sha256(lease_key.encode('ascii')).hexdigest()
    suffix = full_hash[:24]
    ns = f't3-p1-{suffix}'
    ingress_host = f't3-p1-{suffix}'
    labels = {'app': 't3-worker'}
    annotations = {'t3code.dev/lease-key-sha256': full_hash,
                   't3code.dev/lease-expires-at': expires_at,
                   't3code.dev/expiry-enforced': 'false',
                   't3code.dev/retention': 'retain-until-owner-decision'}
    plan = {'format': 't3-k3s-p1-plan-v1', 'leaseHash': full_hash, 'namespace': ns,
            'image': image, 'expiresAt': expires_at, 'retention': 'retain'}

    def obj(api: str, kind: str, name: str, spec: dict | None = None) -> dict:
        doc = {'apiVersion': api, 'kind': kind, 'metadata': {'name': name, 'namespace': ns}}
        if spec is not None:
            doc['spec'] = spec
        return doc

    namespace = {'apiVersion': 'v1', 'kind': 'Namespace', 'metadata': {
        'name': ns, 'annotations': annotations,
        'labels': {'pod-security.kubernetes.io/enforce': 'restricted',
                   'pod-security.kubernetes.io/enforce-version': 'latest'}}}
    quota = obj('v1', 'ResourceQuota', 'worker-quota', {'hard': {
        'pods': '1', 'persistentvolumeclaims': '1', 'requests.cpu': '2',
        'requests.memory': '4Gi', 'limits.cpu': '4', 'limits.memory': '8Gi',
        'requests.storage': '20Gi', 'requests.ephemeral-storage': '2Gi',
        'limits.ephemeral-storage': '4Gi'}})
    sa = obj('v1', 'ServiceAccount', 't3-worker')
    sa['automountServiceAccountToken'] = False
    pvc = obj('v1', 'PersistentVolumeClaim', 't3-worker-data', {
        'accessModes': ['ReadWriteOnce'], 'resources': {'requests': {'storage': '10Gi'}}})
    container = {
        'name': 't3', 'image': image, 'imagePullPolicy': 'IfNotPresent',
        'workingDir': '/data', 'ports': [{'name': 'http', 'containerPort': 3773}],
        'resources': {'requests': {'cpu': '500m', 'memory': '1Gi', 'ephemeral-storage': '512Mi'},
                      'limits': {'cpu': '2', 'memory': '4Gi', 'ephemeral-storage': '2Gi'}},
        'securityContext': {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
                            'capabilities': {'drop': ['ALL']}},
        'startupProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5, 'failureThreshold': 60},
        'readinessProbe': {'tcpSocket': {'port': 'http'}, 'periodSeconds': 5},
        'volumeMounts': [{'name': 'data', 'mountPath': '/data'},
                         {'name': 'tmp', 'mountPath': '/tmp'}],
    }
    pod = {
        'serviceAccountName': 't3-worker', 'automountServiceAccountToken': False,
        'hostname': 't3-worker', 'terminationGracePeriodSeconds': 90,
        'securityContext': {'runAsNonRoot': True, 'runAsUser': 10001,
                            'runAsGroup': 10001, 'fsGroup': 10001,
                            'seccompProfile': {'type': 'RuntimeDefault'}},
        'containers': [container],
        'volumes': [{'name': 'data', 'persistentVolumeClaim': {'claimName': 't3-worker-data'}},
                    {'name': 'tmp', 'emptyDir': {'sizeLimit': '1Gi'}}],
    }
    deployment = obj('apps/v1', 'Deployment', 't3-worker', {
        'replicas': 1, 'strategy': {'type': 'Recreate'}, 'selector': {'matchLabels': labels},
        'template': {'metadata': {'labels': labels}, 'spec': pod}})
    service = obj('v1', 'Service', 't3-worker', {
        'type': 'ClusterIP', 'selector': labels,
        'ports': [{'name': 'http', 'port': 80, 'targetPort': 'http', 'protocol': 'TCP'}]})
    ingress = obj('networking.k8s.io/v1', 'Ingress', 't3-worker', {
        'ingressClassName': 'tailscale', 'tls': [{'hosts': [ingress_host]}],
        'defaultBackend': {'service': {'name': 't3-worker', 'port': {'name': 'http'}}}})
    policy = obj('networking.k8s.io/v1', 'NetworkPolicy', 'worker-ingress', {
        'podSelector': {'matchLabels': labels}, 'policyTypes': ['Ingress'],
        'ingress': [{'from': [{'namespaceSelector': {'matchLabels': {
            'kubernetes.io/metadata.name': 'tailscale'}}}],
            'ports': [{'protocol': 'TCP', 'port': 3773}]}]})
    return plan, [namespace, quota, sa, pvc, deployment, service, ingress, policy]


def lock(state_dir: Path, plan: dict) -> bool:
    """Create-once 0600 local receipt; retries match exactly or fail closed.

    Requires owner-created private absolute directory. Never overwrites a
    conflicting or symlinked plan; never contacts the cluster.
    """
    if not state_dir.is_absolute():
        raise PlanError('state directory must be an absolute owner-private path')
    flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    try:
        directory = os.open(state_dir, flags)
    except OSError as exc:
        raise PlanError('state directory unavailable') from exc
    try:
        st = os.fstat(directory)
        if not stat.S_ISDIR(st.st_mode) or (st.st_mode & 0o077) or st.st_uid != os.getuid():
            raise PlanError('state directory must be owned by caller with mode 0700')
        filename = plan['leaseHash'] + '.json'
        data = (json.dumps(plan, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')
        file_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
        try:
            file = os.open(filename, file_flags, 0o600, dir_fd=directory)
        except FileExistsError:
            file = None
        except OSError as exc:
            raise PlanError('cannot establish local lease receipt') from exc
        if file is not None:
            with os.fdopen(file, 'wb') as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            return True
        read_flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
        try:
            file = os.open(filename, read_flags, dir_fd=directory)
            with os.fdopen(file, 'rb') as source:
                info = os.fstat(source.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077
                        or info.st_uid != os.getuid() or info.st_size > 4096):
                    raise PlanError('existing lease receipt is unsafe')
                previous = source.read(4097)
        except OSError as exc:
            raise PlanError('existing lease receipt unavailable or unsafe') from exc
        if previous != data:
            raise PlanError('same lease key has conflicting image, expiry, or plan contract')
        return False
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lease-key', required=True, help='opaque stable idempotency key (not printed)')
    parser.add_argument('--image', required=True, help='T3-compatible worker image@sha256 digest')
    parser.add_argument('--expires-at', required=True, help='UTC expiry metadata; NOT enforced')
    parser.add_argument('--state-dir', required=True, type=Path, help='pre-existing private (0700) directory')
    args = parser.parse_args()
    try:
        plan, documents = build(args.lease_key, args.image, args.expires_at)
        created = lock(args.state_dir, plan)
    except PlanError as exc:
        parser.exit(1, f'FAIL: {exc}\n')
    # stdout contains declarative YAML only; operator must separately inspect,
    # authorize, and apply. No automatic time-based retention/deletion.
    print(yaml.safe_dump_all(documents, sort_keys=False, explicit_start=True), end='')
    print('P1 PREVIEW ONLY: no cluster write, OAuth pairing, TTL action, or worker execution; '
          f'local receipt {"created" if created else "reused"}', file=sys.stderr)


if __name__ == '__main__':
    main()
