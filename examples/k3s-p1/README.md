# P1 preview — deterministic worker plans, no cluster actuation

**LOCAL CONTRACT ONLY / NOT RUN ON K3s.** This is a stacked preparatory
slice against [P0 draft #46](https://github.com/kvnloo/t3code/pull/46).
No P1 deployment is authorized until the P0 persistent owner passes real
disposable-cluster storage/restart, private HTTPS/ACL, client pairing and
saved-thread acceptance.

## Scope

plan.py turns a stable opaque idempotency key, immutable OCI image digest and
explicit UTC expiration into a reproducible **per-worker environment
blueprint**. The key is hashed (full SHA-256 in a private receipt, truncated
only for DNS names). The raw key is neither logged nor written to Kubernetes.
The file outputs exactly eight ordinary resources: restricted Namespace,
ResourceQuota, no-token ServiceAccount, separate PVC, one Recreate Deployment
running a headless T3 server, ClusterIP Service, private Tailscale Ingress and
an ingress-only NetworkPolicy.

The separate [offline UID observation helper](OBSERVATION.md) checks a
reported Kubernetes Namespace/PVC/Deployment binding **and immutable
image-reference fingerprint** against the plan and an earlier v3 baseline.
It checks the Deployment's desired template image, PVC/SA mounting,
non-root Pod/container security, resources and probes, and rejects host access,
additional containers and injected credentials/command overrides,
not the image of a live Pod. Legacy v1/v2 baselines are rejected. It never contacts a cluster or proves a live T3 worker.

The local private mode-0600 receipt is create-once and atomically published only after a synced write. Concurrent identical requests reuse the complete receipt; a failed publish leaves no half-written final record. A retry with identical
arguments renders identical YAML. Reusing the key with changed image/expiry
fails closed rather than silently rebinding a purported lease. The receipt
is **not** a distributed lock or a cluster reservation. Expiration is advisory
metadata only; **no TTL cleanup or enforcement exists**. PVC retention always
requires a human decision. The CNI and tailnet ACLs still need negative tests;
the manifest does not restrict egress.

## Offline usage

Requires Python 3.10+ and PyYAML. In the fork checkout:

    python3 -m pip install 'PyYAML==6.0.2'
    python3 -m unittest discover -s examples/k3s-p1 -p 'test_*.py' -v

Create a private receipt directory locally:

    mkdir -m 700 /tmp/k3s-p1-receipts

After replacing the placeholder with a **real** verified 64-character
lowercase image digest, run:

    python3 examples/k3s-p1/plan.py \
      --lease-key 'approved-request:example-001' \
      --image 'ghcr.io/OWNER/t3-worker@sha256:REPLACE_WITH_64_HEX' \
      --expires-at '2026-11-01T00:00:00Z' \
      --state-dir /tmp/k3s-p1-receipts > /tmp/k3s-p1-review.yaml

The output is YAML for review, **not an automatic kubectl command**. Do not
use a credential or private text as a lease key. Directory mode must deny
group and other users. If a receipt exists with altered args, the command
fails instead of overwriting it.

## Future acceptance — NOT RUN

1. Complete P0 live acceptance first. Confirm the pinned worker image
   actually supports the latest T3 linked-environment beta, provider/runtime
   requirements, and a persistent environment ID.
2. Inspect the generated eight-object YAML and chosen *disposable* K3s
   context. Verify the computed worker namespace is unused. Any dry run,
   image build or cluster apply requires separate owner authorization.
3. The offline UID helper checks supplied Namespace/PVC snapshots, but does
   not persist a runtime lease or authorize reuse. Develop an opt-in
   reconcile/create/retry path recording verified live Pod/Service ownership,
   stable T3 descriptor, lease identity, expiry and explicit retention/cancel/
   resume states; a lost response must never duplicate accepted completion.
4. Independently approve OAuth peer linking on both environments, then run
   one real remote delegated task against a pinned repository revision.
   Client-saved environment and T3 peer OAuth are not interchangeable.
   Test restart, route loss, token revocation, cancellation and negative ACLs.
5. Never enroll temporary workers automatically in client load balancing or
   assume worker and owner share a filesystem, provider secrets or GPUs.

The original P0 image is pinned to T3 release v0.1.3; latest-main beta
compatibility is **unverified**. This preview does not install tools,
clone repositories, contact Kubernetes, link agents, grant credentials,
launch workers or alter the current deployment.

Canonical decisions: [fork #45](https://github.com/kvnloo/t3code/issues/45).
No upstream writes and no READY status.


## Offline private-route drift check (no cluster calls)

`route_check.py` compares a private P1 plan receipt with saved Kubernetes
**Service, Ingress, named NetworkPolicy and complete namespace-wide ServiceList, IngressList and NetworkPolicyList JSON**. It rejects a public
LoadBalancer/NodePort, external IP, wrong backend, non-Tailscale IngressClass,
Funnel/unreviewed ingress annotations, extra ingress rules, changed tailnet
hostname, a widened NetworkPolicy, **an additional public Ingress or LoadBalancer/NodePort Service, or an additional wildcard-allow policy**.
The helper also inspects **advertised** `Ingress.status.loadBalancer.ingress`
and `Service.status.loadBalancer.ingress` when present, including both
named-object and namespace-inventory snapshots. A public IP, external hostname,
multiple advertised endpoints, inconsistent snapshots or malformed status
fails closed even when the Kubernetes `spec` still looks private. An absent
Ingress status is permitted only for an **unapplied desired-plan check**; it
does **not** mean the route exists. The matching `*.ts.net` name does not
establish tailnet ownership or ACL enforcement. Live HTTPS identity verification
and a separate deny-path probe remain mandatory.

Kubernetes ingress policy rules are additive; checking the named policy alone
cannot exclude another policy that exposes the worker. The inventory must
contain exactly the named policy with the same UID and spec, and exactly the named private Ingress and ClusterIP Service in their respective inventories. The checked-in
`test_route_check.py` covers those regressions. This is a **static desired
spec check**: a matching snapshot does **not** prove a trusted API response,
correct CNI enforcement, private Tailscale TLS/ACLs, OAuth permission or
a working pod. Do not connect or deploy a worker based on this alone.

Only **after P0 real disposable-cluster acceptance** and separate owner
approval for a P1 sandbox, save the read-only API snapshots privately:

```sh
umask 077
mkdir -p /tmp/t3-p1-private
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get service t3-worker -o json > /tmp/t3-p1-private/service.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get ingress t3-worker -o json > /tmp/t3-p1-private/ingress.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get networkpolicy worker-ingress -o json > /tmp/t3-p1-private/policy.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get networkpolicies -o json > /tmp/t3-p1-private/all-policies.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get ingresses -o json > /tmp/t3-p1-private/all-ingresses.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE get services -o json > /tmp/t3-p1-private/all-services.json
python3 examples/k3s-p1/route_check.py \
  --plan /tmp/k3s-p1-receipts/YOUR_FULL_LEASE_SHA256.json \
  --service /tmp/t3-p1-private/service.json \
  --ingress /tmp/t3-p1-private/ingress.json \
  --network-policy /tmp/t3-p1-private/policy.json \
  --all-network-policies /tmp/t3-p1-private/all-policies.json \
  --all-ingresses /tmp/t3-p1-private/all-ingresses.json \
  --all-services /tmp/t3-p1-private/all-services.json
```

A failed check requires manual review, never automatic rollback or deletion.
Unexpected admission-controller annotations and any additional network
policy fail closed. A saved inventory can be stale or collected mid-change. It does not enumerate
routes in other namespaces or non-Kubernetes host networking. Repeat the
approved-context read and independently inspect effective CNI rules.
Also check actual DNS, HTTPS certificate, peer identity, private ACL negative test
and CNI policy enforcement independently; do not treat these API objects as
proof of the data plane.
