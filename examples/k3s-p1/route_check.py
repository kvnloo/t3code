#!/usr/bin/env python3
"""Offline P1 Service/Ingress/NetworkPolicy route contract; never calls Kubernetes.

It checks only desired API objects, not the effective CNI, operator, TLS,
DNS, tailnet ACL, peer OAuth grant, or a running T3 environment.
"""
import argparse
import json
from pathlib import Path
import re


class RouteError(ValueError):
    """A saved Kubernetes route does not match the immutable P1 plan."""


def _same(actual, expected, field):
    if actual != expected:
        raise RouteError(f'{field} differs from private P1 plan')


def _meta(obj, kind, name, namespace):
    if not isinstance(obj, dict) or obj.get('kind') != kind:
        raise RouteError(f'{kind} object is missing or malformed')
    meta = obj.get('metadata')
    if not isinstance(meta, dict) or meta.get('name') != name or meta.get('namespace') != namespace:
        raise RouteError(f'{kind} identity differs from P1 plan')
    if meta.get('deletionTimestamp'):
        raise RouteError(f'{kind} is deleting')
    return meta


def _safe_annotations(obj, kind):
    # Controllers can act on Service annotations even for a ClusterIP.
    # In particular, tailscale.com/expose enables an additional L3 proxy
    # that does not appear in the ordinary Service/Ingress inventories.
    annotations = obj['metadata'].get('annotations', {})
    if (not isinstance(annotations, dict)
            or set(annotations) - {'kubectl.kubernetes.io/last-applied-configuration'}):
        raise RouteError(f'{kind} has unexpected route-affecting annotations')


def _route_status(obj, kind, ns):
    """Fail closed on an API-advertised public/extra route, even if spec is private.

    An empty status is valid for an unapplied desired spec, NOT evidence of
    HTTPS reachability or a trustworthy tailnet identity.
    """
    status = obj.get('status', {})
    if not isinstance(status, dict):
        raise RouteError(f'{kind} has malformed route status')
    lb = status.get('loadBalancer', {})
    if not isinstance(lb, dict):
        raise RouteError(f'{kind} has malformed load-balancer status')
    routes = lb.get('ingress', [])
    if not isinstance(routes, list):
        raise RouteError(f'{kind} advertises malformed routes')
    if kind == 'Service':
        if routes:
            raise RouteError('ClusterIP Service advertises an unexpected external route')
        return
    if not routes:
        return  # Unscheduled ingress: desired spec only, not an HTTPS proof.
    if len(routes) != 1 or not isinstance(routes[0], dict):
        raise RouteError('Ingress advertises unexpected extra routes')
    entry = routes[0]
    if (set(entry) != {'hostname'} or not isinstance(entry['hostname'], str)
            or not re.fullmatch(re.escape(ns) + r'\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net', entry['hostname'])):
        raise RouteError('Ingress does not advertise the private expected hostname')


def verify(plan, service, ingress, policy, all_policies, all_ingresses, all_services):
    """Fail closed for route/spec drift; no cluster writes or readiness claims."""
    if not isinstance(plan, dict) or plan.get('format') != 't3-k3s-p1-plan-v1':
        raise RouteError('invalid P1 plan format')
    lease = plan.get('leaseHash')
    if not isinstance(lease, str) or not re.fullmatch(r'[0-9a-f]{64}', lease):
        raise RouteError('invalid P1 lease hash')
    ns = 't3-p1-' + lease[:24]
    _same(plan.get('namespace'), ns, 'namespace')
    _meta(service, 'Service', 't3-worker', ns)
    _meta(ingress, 'Ingress', 't3-worker', ns)
    _meta(policy, 'NetworkPolicy', 'worker-ingress', ns)
    _safe_annotations(service, 'Service')
    _safe_annotations(ingress, 'Ingress')

    _route_status(service, 'Service', ns)
    _route_status(ingress, 'Ingress', ns)

    spec = service.get('spec')
    if not isinstance(spec, dict):
        raise RouteError('invalid Service spec')
    _same(spec.get('type', 'ClusterIP'), 'ClusterIP', 'Service type')
    _same(spec.get('selector'), {'app': 't3-worker'}, 'Service selector')
    if spec.get('externalIPs') or spec.get('externalName') or spec.get('loadBalancerIP'):
        raise RouteError('Service must not expose public/external endpoints')
    ports = spec.get('ports')
    if not isinstance(ports, list) or len(ports) != 1 or not isinstance(ports[0], dict):
        raise RouteError('Service ports differ from P1 plan')
    port = ports[0]
    for key, expected in {'name': 'http', 'port': 80, 'targetPort': 'http', 'protocol': 'TCP'}.items():
        _same(port.get(key, 'TCP' if key == 'protocol' else None), expected, 'Service port')
    if port.get('nodePort') not in (None, 0):
        raise RouteError('Service NodePort forbidden')

    ispec = ingress.get('spec')
    if not isinstance(ispec, dict):
        raise RouteError('invalid Ingress spec')
    _same(ispec.get('ingressClassName'), 'tailscale', 'private IngressClass')
    if ispec.get('rules') or ispec.get('defaultBackend') != {
        'service': {'name': 't3-worker', 'port': {'name': 'http'}}
    }:
        raise RouteError('Ingress backend or rules differ from private plan')
    _same(ispec.get('tls'), [{'hosts': ['t3-p1-' + lease[:24]]}], 'private Ingress hostname')

    pspec = policy.get('spec')
    if not isinstance(pspec, dict):
        raise RouteError('invalid NetworkPolicy spec')
    _same(pspec.get('podSelector'), {'matchLabels': {'app': 't3-worker'}}, 'policy selector')
    _same(pspec.get('policyTypes'), ['Ingress'], 'policy types')
    _same(pspec.get('ingress'), [{'from': [{'namespaceSelector': {'matchLabels': {
        'kubernetes.io/metadata.name': 'tailscale'}}}],
        'ports': [{'protocol': 'TCP', 'port': 3773}]}], 'private ingress allowlist')
    if pspec.get('egress'):
        raise RouteError('unexpected policy egress needs separate review')

    # Kubernetes ingress policy is additive. A single safe named policy says
    # nothing about a second namespace-wide or wildcard allow policy.
    if (not isinstance(all_policies, dict)
            or all_policies.get('kind') != 'NetworkPolicyList'
            or not isinstance(all_policies.get('items'), list)
            or len(all_policies['items']) != 1):
        raise RouteError('namespace-wide NetworkPolicy inventory is missing or ambiguous')
    listed = all_policies['items'][0]
    listed_meta = _meta(listed, 'NetworkPolicy', 'worker-ingress', ns)
    uid = policy['metadata'].get('uid')
    if (not isinstance(uid, str) or not re.fullmatch(r'[a-zA-Z0-9-]{8,128}', uid)
            or listed_meta.get('uid') != uid):
        raise RouteError('NetworkPolicy identity differs across snapshots')
    _same(listed.get('spec'), pspec, 'inventory NetworkPolicy spec')

    # A second Ingress or LoadBalancer/NodePort Service in this namespace can
    # advertise another route to the same worker. Only inspecting the named
    # private Ingress and ClusterIP Service is not a namespace-wide inventory.
    # This remains a desired-spec audit, NOT proof that traffic is denied.
    for kind, expected, inventory in (
        ('Service', service, all_services),
        ('Ingress', ingress, all_ingresses),
    ):
        if (not isinstance(inventory, dict)
                or inventory.get('kind') != kind + 'List'
                or not isinstance(inventory.get('items'), list)
                or len(inventory['items']) != 1):
            raise RouteError(f'{kind} namespace inventory is missing or ambiguous')
        listed = inventory['items'][0]
        listed_meta = _meta(listed, kind, 't3-worker', ns)
        _safe_annotations(listed, kind)
        expected_uid = expected['metadata'].get('uid')
        if (not isinstance(expected_uid, str)
                or not re.fullmatch(r'[a-zA-Z0-9-]{8,128}', expected_uid)
                or listed_meta.get('uid') != expected_uid):
            raise RouteError(f'{kind} identity differs across snapshots')
        _same(listed.get('spec'), expected.get('spec'), f'inventory {kind} spec')
        _route_status(listed, kind, ns)
        _same(listed.get('status', {}), expected.get('status', {}),
              f'inventory {kind} advertised route status')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('plan', 'service', 'ingress', 'network-policy', 'all-network-policies',
                 'all-ingresses', 'all-services'):
        parser.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    try:
        values = [json.loads(getattr(args, x).read_text(encoding='utf-8'))
                  for x in ('plan', 'service', 'ingress', 'network_policy', 'all_network_policies',
                            'all_ingresses', 'all_services')]
        verify(*values)
    except (OSError, ValueError, TypeError, AttributeError, KeyError) as exc:
        # Do not repeat private kubeconfig paths, DNS names, or JSON in errors.
        parser.exit(1, f'FAIL: P1 private route specification not verified ({type(exc).__name__})\n')
    print('PASS: P1 desired private route and namespace route/policy inventories match (offline only)')
    print('NOT RUN: DNS, private TLS, Tailscale ACL, NetworkPolicy enforcement, OAuth or live delegation')


if __name__ == '__main__':
    main()
