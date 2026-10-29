# P1 offline binding observation — UID + desired Deployment contract

**READ-ONLY SOURCE CHECK; NO K3s EXECUTION OR WORKER AUTHORIZATION.** The
`observe.py` helper compares one immutable P1 plan with API JSON for its
Namespace, PVC and Deployment, then extracts their stable Kubernetes UIDs. A previous
binding can be replay-checked so a replaced Namespace, PVC, Deployment **or pinned image**
**fails closed** rather than looking like the same worker lease. The v3 receipt contains a SHA-256 fingerprint of the full immutable OCI image
reference, never the raw registry/image name, and checks the observed
Deployment's **desired Pod template** image equals the plan. It also requires the
planned non-root Pod/container security, resource bounds, probes and no unexpected
host-network/PID/IPC access, injected init containers, registry credentials,
environment secrets or shell overrides. An unexpected admission mutation fails
closed for human review; Kubernetes may default other fields. Old v1/v2 binding
baselines cannot be reused: recollect a trusted v3 baseline from one approved
context. This does **not** check the image actually running in any Pod.

This is **not** a provisioner, cluster lease, service/Pod readiness probe,
T3 environment identity check, HTTPS proof, peer authorization, task
completion, automatic expiry, or deletion approval. The CLI contacts **no**
cluster. JSON files can be stale or fabricated, so source and context must
be independently verified; never promote a local fixture to live evidence.

## Reproducible offline tests

From the fork checkout (no kubeconfig or provider token needed):

```sh
python3 -m unittest discover -s examples/k3s-p1 -p 'test_*.py' -v
python3 -m py_compile examples/k3s-p1/observe.py
```

The twelve focused binding tests check stable UIDs, lease/namespace mismatch,
PVC replacement, invalid/unbound/deleting storage, retention/annotation drift,
immutable image reference drift/format, rejection of a legacy v1 baseline,
desired Deployment image/ServiceAccount/volume/selector and privilege/credential/resource drift, and CLI failure
without printing private IDs.

## Human-gated future Kubernetes observation (NOT RUN)

**Only after P0 real disposable-cluster acceptance and separate approval to
create one P1 worker**, inspect the rendered plan and explicitly confirm the
selected kubeconfig context and physical machine. The following commands are
read-only; they never deploy, pair, cancel, renew, clean up or grant access.
Keep output in an owner-private directory; do not commit snapshots/receipts.

```sh
umask 077
mkdir -p /tmp/t3-p1-private
# Use the namespace printed by plan.py, not a guessed or existing namespace.
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT get namespace YOUR_P1_NAMESPACE \
  -o json > /tmp/t3-p1-private/namespace.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE \
  get pvc t3-worker-data -o json > /tmp/t3-p1-private/pvc.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE \
  get deployment t3-worker -o json > /tmp/t3-p1-private/deployment.json
python3 examples/k3s-p1/observe.py \
  --plan /tmp/k3s-p1-receipts/YOUR_FULL_LEASE_SHA256.json \
  --namespace /tmp/t3-p1-private/namespace.json \
  --pvc /tmp/t3-p1-private/pvc.json \
  --deployment /tmp/t3-p1-private/deployment.json \
  > /tmp/t3-p1-private/binding.json
```

For a subsequent observation, **refresh all three Kubernetes JSON snapshots from the same
approved context** and use the **same pinned image receipt**, then pass
`--baseline /tmp/t3-p1-private/binding.json`. A Namespace/PVC/Deployment UID, desired image or PV
binding change now fails. A missing/unbound PVC or lease/retention mismatch
also fails; nothing is automatically repaired or deleted. Store the baseline
safely and never overwrite it merely to make a failing comparison pass.

**Still required separately:** verify the server's persisted T3
`environmentId` and actual live Pod UID/image/Service/EndpointSlice (independent from the desired
Deployment spec),
private TLS and negative ACL tests, consented MCP OAuth link, exact pinned
repository/delegated task result, cancel/restart/TTL behavior and deliberate
PVC retention. An old or expired plan is not a live reservation. Consult
[work order #45](https://github.com/kvnloo/t3code/issues/45) and
[stacked Draft #47](https://github.com/kvnloo/t3code/pull/47) for gates.
