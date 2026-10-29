#!/usr/bin/env python3
"""Read-only P1 Pod ownership/runtime snapshot check; NEVER a live attestation."""
import argparse
import hashlib
import json
from pathlib import Path
import re


class PodError(ValueError):
    """An untrusted Kubernetes snapshot does not support the claimed worker."""


def need(condition, message):
    if not condition:
        raise PodError(message)


def meta(obj, kind, namespace):
    need(isinstance(obj, dict) and obj.get('kind') == kind, 'invalid object kind')
    value = obj.get('metadata')
    need(isinstance(value, dict) and value.get('namespace') == namespace
         and not value.get('deletionTimestamp'), 'resource identity or deletion drift')
    uid = value.get('uid')
    need(isinstance(uid, str) and re.fullmatch(r'[A-Za-z0-9-]{8,128}', uid), 'missing resource UID')
    return value


def controller(obj, kind, name, uid):
    refs = obj.get('metadata', {}).get('ownerReferences')
    need(isinstance(refs, list) and len(refs) == 1, 'missing exclusive controller reference')
    ref = refs[0]
    need(isinstance(ref, dict) and ref.get('controller') is True
         and (ref.get('kind'), ref.get('name'), ref.get('uid')) == (kind, name, uid),
         'controller reference drift')


def inspect(plan, binding, deployment, replicasets, pods):
    """Check offline snapshots from one approved context, not actual connectivity."""
    need(isinstance(plan, dict) and isinstance(binding, dict), 'invalid plan/binding')
    lease = plan.get('leaseHash')
    need(plan.get('format') == 't3-k3s-p1-plan-v1' and isinstance(lease, str)
         and re.fullmatch(r'[0-9a-f]{64}', lease), 'invalid immutable plan')
    ns = 't3-p1-' + lease[:24]
    image = plan.get('image')
    need(isinstance(image, str) and re.fullmatch(
         r'(?=.{1,255}$)[a-z0-9][a-z0-9._:/-]*/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}', image)
         and '..' not in image and '//' not in image, 'image not pinned')
    image_hash = hashlib.sha256(image.encode('ascii')).hexdigest()
    need(plan.get('namespace') == ns and binding.get('format') == 't3-k3s-p1-binding-v4'
         and binding.get('namespace') == ns and binding.get('leaseHash') == lease
         and binding.get('imageRefSha256') == image_hash, 'lease binding mismatch')
    dmeta = meta(deployment, 'Deployment', ns)
    need(dmeta.get('name') == 't3-worker' and dmeta['uid'] == binding.get('deploymentUID'),
         'deployment binding drift')
    # A Deployment may keep its UID while its desired spec is changed. The
    # read-only binding must be refreshed and re-reviewed for any new generation.
    need(type(dmeta.get('generation')) is int and dmeta['generation'] > 0
         and binding.get('deploymentGeneration') == dmeta['generation'],
         'deployment changed since verified binding')
    ds = deployment.get('spec', {})
    template = ds.get('template', {}).get('spec', {})
    need(isinstance(template, dict) and isinstance(template.get('containers'), list)
         and len(template['containers']) == 1 and template['containers'][0].get('image') == image,
         'deployment image drift')
    status = deployment.get('status', {})
    need(isinstance(status, dict) and isinstance(dmeta.get('generation'), int)
         and status.get('observedGeneration') == dmeta['generation']
         and all(status.get(k) == 1 for k in ('replicas', 'readyReplicas', 'availableReplicas', 'updatedReplicas')),
         'deployment rollout not observed ready')
    need(isinstance(replicasets, dict) and replicasets.get('kind') == 'ReplicaSetList'
         and isinstance(replicasets.get('items'), list), 'incomplete ReplicaSet inventory')
    active_rs = []
    for rs in replicasets['items']:
        rm = meta(rs, 'ReplicaSet', ns)
        controller(rs, 'Deployment', 't3-worker', dmeta['uid'])
        rs_spec = rs.get('spec', {})
        rs_status = rs.get('status', {})
        need(isinstance(rs_spec, dict) and isinstance(rs_status, dict), 'malformed ReplicaSet')
        if rs_spec.get('replicas', 0) or rs_status.get('replicas', 0):
            active_rs.append((rs, rm))
    need(len(active_rs) == 1, 'ambiguous live ReplicaSet')
    rs, rm = active_rs[0]
    need(rs.get('spec', {}).get('replicas') == 1
         and rs.get('status', {}).get('readyReplicas') == 1, 'ReplicaSet not ready')
    # ReplicaSet is the template used for the NEXT Pod after restart/eviction.
    # A clean, Ready Pod is insufficient if its controller was subsequently
    # changed to launch a different image, credential or unsafe container.
    # Compare spec only: Deployment adds pod-template-hash to RS template labels.
    rs_template = rs.get('spec', {}).get('template')
    need(isinstance(rs_template, dict) and isinstance(rs_template.get('spec'), dict)
         and rs_template['spec'] == template, 'active ReplicaSet template drift')
    # Spec equality alone misses an edited replacement template's labels,
    # selector or annotations. Those can change routing or trigger admission
    # sidecars when the ReplicaSet creates a replacement Pod.
    desired_meta = ds.get('template', {}).get('metadata')
    replacement_meta = rs_template.get('metadata')
    need(isinstance(desired_meta, dict) and isinstance(replacement_meta, dict)
         and set(desired_meta) <= {'labels', 'annotations', 'creationTimestamp'}
         and set(replacement_meta) <= {'labels', 'annotations', 'creationTimestamp'}
         and desired_meta.get('creationTimestamp') is None
         and replacement_meta.get('creationTimestamp') is None
         and desired_meta.get('labels') == {'app': 't3-worker'}
         and not desired_meta.get('annotations')
         and not replacement_meta.get('annotations'),
         'replacement Pod template metadata drift')
    replacement_labels = replacement_meta.get('labels')
    need(isinstance(replacement_labels, dict)
         and set(replacement_labels) == {'app', 'pod-template-hash'}
         and replacement_labels.get('app') == 't3-worker'
         and isinstance(replacement_labels.get('pod-template-hash'), str)
         and re.fullmatch(r'[a-z0-9-]{1,63}', replacement_labels['pod-template-hash']),
         'replacement Pod template labels drift')
    selector = rs.get('spec', {}).get('selector')
    need(isinstance(selector, dict)
         and selector.get('matchLabels') == replacement_labels
         and not selector.get('matchExpressions')
         and set(selector) <= {'matchLabels', 'matchExpressions'},
         'active ReplicaSet selector drift')
    need(isinstance(pods, dict) and pods.get('kind') == 'PodList'
         and isinstance(pods.get('items'), list) and len(pods['items']) == 1,
         'worker namespace does not have exactly one Pod')
    pod = pods['items'][0]
    pm = meta(pod, 'Pod', ns)
    controller(pod, 'ReplicaSet', rm.get('name'), rm['uid'])
    need(pm.get('labels') == replacement_labels, 'Pod selector drift')
    ps = pod.get('spec', {})
    need(isinstance(ps, dict) and ps.get('serviceAccountName') == 't3-worker'
         and ps.get('automountServiceAccountToken') is False
         and ps.get('securityContext') == template.get('securityContext')
         and ps.get('volumes') == template.get('volumes'), 'admitted Pod security/storage drift')
    for field in ('hostNetwork', 'hostPID', 'hostIPC', 'shareProcessNamespace'):
        need(ps.get(field) in (None, False), 'Pod host isolation drift')
    for field in ('initContainers', 'ephemeralContainers', 'imagePullSecrets', 'hostAliases'):
        need(not ps.get(field), 'unexpected Pod configuration')
    containers = ps.get('containers')
    need(isinstance(containers, list) and len(containers) == 1
         and isinstance(containers[0], dict), 'unexpected Pod containers')
    for field in ('name', 'image', 'securityContext', 'resources', 'volumeMounts'):
        need(containers[0].get(field) == template['containers'][0].get(field),
             'admitted container configuration drift')
    for field in ('env', 'envFrom', 'command', 'args', 'volumeDevices',
                  'lifecycle', 'stdin', 'stdinOnce', 'tty'):
        need(not containers[0].get(field), 'injected Pod command or lifecycle drift')
    # The desired Deployment snapshot is inspected separately. Bind the admitted
    # Pod's startup path and port/probes to it; matching only image/resources
    # misses hostPort, postStart exec and probe-command injection.
    need(ps.get('hostname') == template.get('hostname'), 'Pod hostname drift')
    desired = template['containers'][0]
    admitted = containers[0]
    for field in ('workingDir', 'imagePullPolicy'):
        need(admitted.get(field) == desired.get(field),
             'admitted container startup drift')
    want_ports, got_ports = desired.get('ports'), admitted.get('ports')
    need(isinstance(want_ports, list) and len(want_ports) == 1
         and isinstance(want_ports[0], dict)
         and isinstance(got_ports, list) and len(got_ports) == 1
         and isinstance(got_ports[0], dict), 'admitted container port drift')
    wp, gp = want_ports[0], got_ports[0]
    need(gp.get('name') == wp.get('name')
         and gp.get('containerPort') == wp.get('containerPort')
         and gp.get('protocol', 'TCP') == wp.get('protocol', 'TCP')
         and gp.get('hostPort') in (None, 0) and not gp.get('hostIP'),
         'admitted container port or host exposure drift')
    probe_defaults = {'periodSeconds': 10, 'failureThreshold': 3,
                      'timeoutSeconds': 1, 'successThreshold': 1,
                      'initialDelaySeconds': 0}
    for name in ('startupProbe', 'readinessProbe'):
        expected_probe, actual_probe = desired.get(name), admitted.get(name)
        need(isinstance(expected_probe, dict) and isinstance(actual_probe, dict)
             and set(actual_probe) <= set(probe_defaults) | {'tcpSocket'}
             and actual_probe.get('tcpSocket') == expected_probe.get('tcpSocket'),
             'admitted container probe drift')
        for field, default in probe_defaults.items():
            need(actual_probe.get(field, default) == expected_probe.get(field, default),
                 'admitted container probe timing drift')
    pod_status = pod.get('status', {})
    need(isinstance(pod_status, dict) and pod_status.get('phase') == 'Running', 'Pod not running')
    conditions = pod_status.get('conditions')
    need(isinstance(conditions, list) and any(isinstance(c, dict)
         and c.get('type') == 'Ready' and c.get('status') == 'True' for c in conditions),
         'Pod not reported ready')
    cs = pod_status.get('containerStatuses')
    need(isinstance(cs, list) and len(cs) == 1 and isinstance(cs[0], dict),
         'missing container status')
    c = cs[0]
    need(c.get('name') == 't3' and c.get('ready') is True
         and c.get('started') is True and isinstance(c.get('state'), dict)
         and isinstance(c['state'].get('running'), dict), 'T3 process not reported ready')
    need(c.get('image') == image, 'running image reference differs from lease')
    cid, iid = c.get('containerID'), c.get('imageID')
    need(isinstance(cid, str) and len(cid) >= 16
         and isinstance(iid, str) and re.search(r'sha256:[a-f0-9]{64}', iid),
         'runtime container or image ID missing')
    restarts = c.get('restartCount')
    need(type(restarts) is int and restarts >= 0, 'invalid restart count')
    return {'format': 't3-k3s-p1-pod-snapshot-v1', 'leaseHash': lease,
            'deploymentUID': dmeta['uid'], 'replicaSetUID': rm['uid'],
            'podUID': pm['uid'], 'imageRefSha256': image_hash,
            'imageIDSha256': hashlib.sha256(iid.encode()).hexdigest(),
            'containerIDSha256': hashlib.sha256(cid.encode()).hexdigest(),
            'restartCount': restarts}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for flag in ('plan', 'binding', 'deployment', 'replicasets', 'pods'):
        p.add_argument('--' + flag, required=True, type=Path)
    a = p.parse_args()
    try:
        docs = [json.loads(getattr(a, key).read_text(encoding='utf-8'))
                for key in ('plan', 'binding', 'deployment', 'replicasets', 'pods')]
        receipt = inspect(*docs)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError) as exc:
        p.exit(1, f'FAIL: P1 offline Pod snapshot not verified ({type(exc).__name__})\n')
    print(json.dumps(receipt, sort_keys=True))
    print('NOT RUN: trusted live cluster, actual digest attestation, T3 identity, HTTPS, OAuth, delegation')


if __name__ == '__main__':
    main()
