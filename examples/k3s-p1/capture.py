#!/usr/bin/env python3
"""Read-only, fail-closed P1 Kubernetes snapshot capture; never applies resources.

Human-approved disposable K3s context required. Snapshots are not live
attestation or peer authorization. Private local output, not a lease.
"""

import argparse
import ctypes
import errno
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile


class CaptureError(RuntimeError):
    """Cannot safely capture a coherent P1 API snapshot."""


NAMES = (
    ('namespace', 'namespace', None),
    ('quota', 'resourcequota', 'worker-quota'),
    ('serviceaccount', 'serviceaccount', 't3-worker'),
    ('pvc', 'pvc', 't3-worker-data'),
    ('deployment', 'deployment', 't3-worker'),
    ('service', 'service', 't3-worker'),
    ('ingress', 'ingress', 't3-worker'),
    ('policy', 'networkpolicy', 'worker-ingress'),
)
LISTS = (
    ('all-policies', 'networkpolicies', 'NetworkPolicyList'),
    ('all-ingresses', 'ingresses', 'IngressList'),
    ('all-services', 'services', 'ServiceList'),
    ('replicasets', 'replicasets', 'ReplicaSetList'),
    ('pods', 'pods', 'PodList'),
)

NAMED_KINDS = {
    'namespace': 'Namespace',
    'quota': 'ResourceQuota',
    'serviceaccount': 'ServiceAccount',
    'pvc': 'PersistentVolumeClaim',
    'deployment': 'Deployment',
    'service': 'Service',
    'ingress': 'Ingress',
    'policy': 'NetworkPolicy',
}



# Exact P1 manifest controls from plan.py. ResourceQuota scopes can exempt a
# worker from limits; named-object identity alone is not enough for review.
# These API objects are snapshots, not proof of quota/RBAC enforcement.
EXPECTED_QUOTA_HARD = {
    'pods': '1', 'persistentvolumeclaims': '1',
    'requests.cpu': '2', 'requests.memory': '4Gi',
    'limits.cpu': '4', 'limits.memory': '8Gi',
    'requests.storage': '20Gi',
    'requests.ephemeral-storage': '2Gi',
    'limits.ephemeral-storage': '4Gi',
}


def _validate_controls(entries):
    quota = entries['quota']
    service_account = entries['serviceaccount']
    qmeta = quota['metadata']
    smeta = service_account['metadata']
    if qmeta.get('deletionTimestamp') or smeta.get('deletionTimestamp'):
        raise CaptureError('worker control resource is deleting')
    spec = quota.get('spec')
    status = quota.get('status')
    if (not isinstance(spec, dict) or set(spec) != {'hard'}
            or spec.get('hard') != EXPECTED_QUOTA_HARD
            or not isinstance(status, dict)
            or status.get('hard') != EXPECTED_QUOTA_HARD):
        raise CaptureError('worker quota scope, bounds, or reconciliation differs from plan')
    if (service_account.get('automountServiceAccountToken') is not False
            or service_account.get('secrets')
            or service_account.get('imagePullSecrets')):
        raise CaptureError('worker ServiceAccount credential policy differs from plan')


def _read(context, namespace, resource, name, runner):
    command = ['kubectl', '--context', context, '--request-timeout=10s']
    if resource != 'namespace':
        command += ['-n', namespace]
    command += ['get', resource]
    if name:
        command.append(name)
    elif resource == 'namespace':
        command.append(namespace)
    command += ['-o', 'json']
    try:
        response = runner(command, capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CaptureError('read-only Kubernetes API request unavailable') from exc
    if response.returncode:
        raise CaptureError('read-only Kubernetes API request rejected')
    try:
        item = json.loads(response.stdout)
    except (ValueError, TypeError) as exc:
        raise CaptureError('malformed Kubernetes JSON') from exc
    if not isinstance(item, dict):
        raise CaptureError('unexpected Kubernetes API response')
    return item


def capture(context, plan, runner=subprocess.run):
    """Collect named objects and inventories, rejecting concurrent changes.

    Re-reading cannot make Kubernetes's multi-call snapshot atomic. Recheck
    context and resource identities independently before trusting any result.
    """
    if (not isinstance(context, str) or not context or context != context.strip()
            or context.startswith('-') or any(c in context for c in '\r\n\x00')):
        raise CaptureError('explicit kubectl context required')
    if not isinstance(plan, dict) or plan.get('format') != 't3-k3s-p1-plan-v1':
        raise CaptureError('invalid immutable plan')
    lease = plan.get('leaseHash')
    if not isinstance(lease, str) or not re.fullmatch('[0-9a-f]{64}', lease):
        raise CaptureError('invalid lease hash')
    namespace = 't3-p1-' + lease[:24]
    if plan.get('namespace') != namespace:
        raise CaptureError('namespace differs from lease plan')
    entries = {}
    for key, resource, name in NAMES:
        item = _read(context, namespace, resource, name, runner)
        meta = item.get('metadata')
        expected_name = namespace if resource == 'namespace' else name
        if (item.get('kind') != NAMED_KINDS[key]
                or not isinstance(meta, dict)
                or meta.get('name') != expected_name
                or not isinstance(meta.get('uid'), str) or not meta['uid']):
            raise CaptureError('named Kubernetes identity does not match the lease')
        if resource == 'namespace':
            if meta.get('namespace') not in (None, ''):
                raise CaptureError('Namespace carries a foreign namespace')
        elif meta.get('namespace') != namespace:
            raise CaptureError('named resource belongs to a different namespace')
        entries[key] = item
    _validate_controls(entries)
    for key, resource, kind in LISTS:
        item = _read(context, namespace, resource, None, runner)
        if item.get('kind') != kind or not isinstance(item.get('items'), list):
            raise CaptureError('incomplete namespace inventory')
        if any(not isinstance(obj, dict) or not isinstance(obj.get('metadata'), dict)
               or obj['metadata'].get('namespace') != namespace for obj in item['items']):
            raise CaptureError('inventory contains a foreign or malformed object')
        entries[key] = item
    # Separate named GET and LIST requests can observe different objects even
    # when each individual request remains stable across both reads. Reject
    # mixed snapshots before publishing a seemingly coherent private receipt.
    for key, inventory in (('policy', 'all-policies'),
                           ('ingress', 'all-ingresses'),
                           ('service', 'all-services')):
        named = entries[key]
        matches = [obj for obj in entries[inventory]['items']
                   if obj['metadata'].get('name') == named['metadata']['name']]
        if len(matches) != 1 or matches[0] != named:
            raise CaptureError('named route or policy disagrees with namespace inventory')
    # Read everything again: reject mid-capture mutation of named endpoints,
    # Deployments, Pods, ReplicaSets or extra namespace routes/policies.
    for key, resource, name in NAMES:
        if entries[key] != _read(context, namespace, resource, name, runner):
            raise CaptureError('named resource changed during capture')
    for key, resource, kind in LISTS:
        if entries[key] != _read(context, namespace, resource, None, runner):
            raise CaptureError('namespace inventory changed during capture')
    return entries



def _rename_directory_exclusive(source: Path, target: Path, parent_fd: int):
    """Publish a directory atomically without clobbering another writer.

    This is a Linux-only acceptance helper. Without renameat2's
    RENAME_NOREPLACE support, fail closed rather than overwriting evidence.
    """
    renameat2 = getattr(ctypes.CDLL(None, use_errno=True), 'renameat2', None)
    if renameat2 is None:
        raise CaptureError('atomic no-replace directory publication unavailable')
    renameat2.argtypes = (ctypes.c_int, ctypes.c_char_p,
                          ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    renameat2.restype = ctypes.c_int
    if renameat2(parent_fd, os.fsencode(source.name),
                 parent_fd, os.fsencode(target.name), 1):  # RENAME_NOREPLACE
        if ctypes.get_errno() == errno.EEXIST:
            raise CaptureError('output directory already exists')
        raise CaptureError('atomic no-replace directory publication unavailable')

def publish(entries, output):
    """Atomically expose a new private directory only after all files sync."""
    if not output.is_absolute() or output.exists() or output.is_symlink():
        raise CaptureError('output must be a new absolute directory')
    parent = output.parent
    try:
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0))
    except OSError as exc:
        raise CaptureError('private output parent unavailable') from exc
    try:
        meta = os.fstat(parent_fd)
        if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077:
            raise CaptureError('output parent must be caller-owned and private (0700)')
        temp = Path(tempfile.mkdtemp(prefix='.p1-capture-', dir=parent))
        try:
            for key, item in entries.items():
                path = temp / (key + '.json')
                with path.open('x', encoding='utf-8') as file:
                    os.chmod(path, 0o600)
                    json.dump(item, file, sort_keys=True)
                    file.write('\n')
                    file.flush()
                    os.fsync(file.fileno())
            # Sync staging directory entries before the parent rename. File
            # fsync alone does not durably commit the file names inside it.
            temp_fd = os.open(temp, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0))
            try:
                os.fsync(temp_fd)
            finally:
                os.close(temp_fd)
            _rename_directory_exclusive(temp, output, parent_fd)
            os.fsync(parent_fd)
        finally:
            if temp.exists():
                shutil.rmtree(temp)
    finally:
        os.close(parent_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding='utf-8'))
        entries = capture(args.context, plan)
        publish(entries, args.output_dir)
    except (OSError, ValueError, TypeError, AttributeError, CaptureError) as exc:
        parser.exit(1, f'FAIL: P1 read-only snapshot capture ({type(exc).__name__})\n')
    print('PASS: 13 API JSON snapshots captured to private directory (read-only Kubernetes calls)')
    print('NOT RUN: live integrity attestation, HTTPS, OAuth, linked delegation, cancellation, TTL')


if __name__ == '__main__':
    main()
