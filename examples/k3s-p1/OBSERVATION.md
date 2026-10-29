# P1 offline binding observation — UID + desired Deployment contract

**READ-ONLY SOURCE CHECK; NO K3s EXECUTION OR WORKER AUTHORIZATION.** The
`observe.py` helper compares one immutable P1 plan with API JSON for its
Namespace, PVC and Deployment, then extracts their stable Kubernetes UIDs. A previous
binding can be replay-checked so a replaced Namespace, PVC, Deployment **or pinned image**
**fails closed** rather than looking like the same worker lease. The v4 receipt contains a SHA-256 fingerprint of the full immutable OCI image
reference, never the raw registry/image name, and checks the observed
Deployment's **desired Pod template** image equals the plan. It also requires the
planned non-root Pod/container security, resource bounds, probes and no unexpected
host-network/PID/IPC access, injected init containers, registry credentials,
environment secrets or shell overrides. An unexpected admission mutation fails
closed for human review; Kubernetes may default other fields. Old v1/v2 binding
or v3 baselines cannot be reused: recollect a trusted v4 baseline from one approved
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

The focused binding tests check stable UIDs, lease/namespace mismatch,
PVC replacement, invalid/unbound/deleting storage, malformed API JSON and
invalid lease calendar dates (without a raw CLI traceback), retention/annotation drift,
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
binding or Deployment generation change now fails. A missing/unbound PVC or lease/retention mismatch
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

## Optional read-only Pod runtime snapshot — NOT live proof

After the desired-spec binding above, `pod_check.py` checks **saved JSON**
from one approved disposable K3s context. It binds Deployment UID →
ReplicaSet controller UID → the **only** Pod UID, verifies Deployment rollout
generation/ready replicas, Pod/container readiness as reported by Kubernetes,
pinned container image reference, required Pod security/storage, and hashes
the runtime image/container IDs into a private receipt. The v4 binding also
pins the Deployment's observed generation, so a changed spec on the same UID
cannot be mistaken for the originally reviewed Deployment. It rejects extra Pods,
stale rollout, wrong controller, changed image, extra containers/credentials and
unapproved Pod mutations. Older inactive ReplicaSets are permitted.

These are **offline comparisons of supplied snapshots**, not authentication
of the Kubernetes API, live reachability, effective isolation, T3 persisted
`environmentId`, peer permission or accepted work. The imageID *hash* is
an observation, **not** equality proof against a multi-platform manifest's
pinned digest. Pod UID changing across restarts needs separate review; stable
Deployment/PVC identity cannot substitute for T3's persisted identity.

Only after a separately approved P1 cluster run, save full namespace
inventories from the **same explicitly verified kubeconfig context**, close
together in time, into an owner-private directory:

```sh
umask 077
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE \
  get replicasets -o json > /tmp/t3-p1-private/replicasets.json
kubectl --context YOUR_APPROVED_DISPOSABLE_CONTEXT -n YOUR_P1_NAMESPACE \
  get pods -o json > /tmp/t3-p1-private/pods.json
# Re-capture deployment.json alongside both inventories; keep the existing
# original, independently verified binding.json and lease plan.
python3 examples/k3s-p1/pod_check.py \
  --plan /tmp/k3s-p1-receipts/YOUR_FULL_LEASE_SHA256.json \
  --binding /tmp/t3-p1-private/binding.json \
  --deployment /tmp/t3-p1-private/deployment.json \
  --replicasets /tmp/t3-p1-private/replicasets.json \
  --pods /tmp/t3-p1-private/pods.json \
  > /tmp/t3-p1-private/pod-snapshot.json
```

If the Deployment generation changes, stop, review the new desired spec and
re-run `observe.py` against fresh same-context snapshots; do **not** overwrite
the original binding merely to make the check pass. Kubernetes increments
Deployment generation on spec changes, but offline snapshots can still be forged.

Run `python3 -m unittest discover -s examples/k3s-p1 -p 'test_pod_check.py' -v`
for synthetic, credential-free regressions. Keep API snapshots private; they may
expose Pod labels and topology. No `kubectl apply`, no network calls from the
script and no automatic worker acceptance. After this check, **still NOT RUN**:
real T3 environment identity, private TLS/ACL, consented OAuth peer link,
verified delegated result and cancellation/restart behavior.
