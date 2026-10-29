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

The offline route checker also rejects unexpected Service annotations, including
`tailscale.com/expose`, on both the named object and its namespace inventory.
A `ClusterIP` Service with that annotation can create a separate Tailscale L3
proxy without a second Ingress. A matching snapshot is still **not** network
isolation, TLS, ACL or peer-authorization proof.

The separate [offline UID observation helper](OBSERVATION.md) checks a
reported Kubernetes Namespace/PVC/Deployment binding **and immutable
image-reference fingerprint** against the plan and an earlier v4 baseline. The v4 binding also pins
the Deployment generation, preventing a same-UID spec update from passing a
later Pod check without renewed human review.
It checks the Deployment's desired template image, PVC/SA mounting,
non-root Pod/container security, resources and probes, and rejects host access,
additional containers and injected credentials/command overrides,
not the image of a live Pod. Legacy v1/v2/v3 baselines are rejected. It never contacts a cluster or proves a live T3 worker.

After the offline desired Deployment/PVC binding, the optional [Pod snapshot checker](OBSERVATION.md#optional-read-only-pod-runtime-snapshot--not-live-proof) can validate saved ReplicaSet→Pod controller UID, API-reported readiness and running image reference, and reject concurrent/mutated Pods, unexpected host ports, changed startup/probe behavior or injected post-start hooks. It also compares the active ReplicaSet's replacement-Pod spec, template labels/annotations and selector with the approved Deployment, rejecting injection or routing drift that could affect a future Pod after restart/eviction. This check also rejects unapproved **Pod-level annotations** (including Multus secondary-network attachments), injected runtime classes / GPU resource claims, changed DNS/placement controls, and mismatched termination/service-account fields while permitting normal Kubernetes defaults. If the cluster injects benign annotations, review them explicitly before changing the strict contract; never silently allow all annotations. This is still **NOT live K3s proof**: its hashed imageID does not attest a multi-platform OCI digest, and it cannot establish persisted T3 identity, TLS, peer consent or successful delegation.

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
compatibility is **unverified**. At upstream main `960d5761c13f68a2f10635bcd26489a5fa404ec1`
(2026-10-29), linked-environment `RemoteDelegation.ts` exists but still launches a
remote child before recording the owning task ([#17051](https://github.com/pingdotgg/t3code/issues/17051));
its restart durability is not proven. This preview does not install tools,
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


## Optional read-only, revision-checked snapshot collection

**NOT RUN on any cluster.** Only after a human has separately approved a
*disposable* P1 K3s worker and its exact context, the new `capture.py`
reduces mistakes in the manual observation commands above. It uses only
explicit-context `kubectl get -o json` calls with deadlines; it cannot
provision, mutate, link, cancel or delete a worker. It collects eight named
resources (Namespace, ResourceQuota, ServiceAccount, PVC, Deployment, Service,
Ingress, NetworkPolicy) and five complete namespace inventories (policies, ingresses, services,
ReplicaSets, Pods). Each is read twice and mismatches fail closed **before
any output is published**. Named resources must have the planned Kubernetes
kind/name/namespace and a UID; the named Service, Ingress and NetworkPolicy
must also exactly match their corresponding namespace-inventory entry.
This rejects mixed GET/LIST views even when each view is independently stable.
The extra quota and no-token ServiceAccount snapshots are for *subsequent*
human/offline security review; collection alone does **not** validate their
specifications or prove admission limits and token restrictions are enforced.
It catches only a subset of mid-capture drift: Kubernetes offers **no atomic
cross-resource snapshot** here, and matching objects do not prove freshness,
route integrity or runtime attestation.

Create a new path inside a private, caller-owned 0700 directory.
Snapshot JSON may contain private addresses, labels, topology and paths,
so **never commit or share the output**.

```sh
umask 077
mkdir -m 700 /tmp/t3-p1-captures
python3 examples/k3s-p1/capture.py \
  --context YOUR_APPROVED_DISPOSABLE_CONTEXT \
  --plan /tmp/k3s-p1-receipts/YOUR_FULL_LEASE_SHA256.json \
  --output-dir /tmp/t3-p1-captures/first
```

The command refuses existing destination paths, non-private parents,
invalid plans or inconsistent repeated reads. It writes each JSON as 0600
and atomically publishes the directory after all writes are synced. Linux
`renameat2(RENAME_NOREPLACE)` prevents a racing writer's empty destination
directory from being replaced; unsupported kernels fail closed, not silently
overwrite a previous snapshot. Run
existing `observe.py`, `pod_check.py` and `route_check.py` on these
**saved files**, using `first/namespace.json`, `first/quota.json`,
`first/serviceaccount.json`, `first/pvc.json`,
`first/deployment.json`, `first/service.json`,
`first/ingress.json`, `first/policy.json`,
`first/all-policies.json`, `first/all-ingresses.json`,
`first/all-services.json`, `first/replicasets.json`, and
`first/pods.json`. Never overwrite a previously accepted baseline.
Repeat capture into a *new* private directory when observing recovery.

For credential-free development tests (does **not** contact kubectl):

```sh
python3 -m unittest discover -s examples/k3s-p1 -p 'test_capture.py' -v
python3 -m py_compile examples/k3s-p1/capture.py examples/k3s-p1/test_capture.py
```

Upstream `main@08a463e29976617134de01e9341f898bc881d0eb` (2026-10-29)
documents linked-environment `delegate_task` and permissioned peer linking
in `docs/user/remote-access.md` and
`docs/internals/remote.md`; this is source-level availability on
`main`, **not** verified compatibility of the P0 `v0.1.3` image.
Upstream record-before-launch issue #17051 remains open. Human-approved
live P0 persistence/route/client proof and P1 OAuth/delegation are still HOLD.
