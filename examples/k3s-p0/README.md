# Experimental P0: persistent T3 environment on self-owned K3s

**Downstream-only, NOT deployed/tested on a live cluster.** This is one **owner**
T3 server with a stable /data PVC and private Tailscale HTTPS ingress, not a
worker broker, task scheduler, T3 Connect replacement, or permissioned peer link.
Nothing is applied automatically. Keep the user's current T3 deployment intact.

## Source and version boundary

- Reviewed upstream `pingdotgg/t3code` main at
  `5211acfe95a0c6d82a60e2524b5e46b47fe67a3e` (2026-10-28). The image
  instead packages the **released** self-contained CLI `v0.1.3`, published
  2026-10-27. A release is not proof that every latest-main linked-environment
  beta behavior exists in it. P1 must pin and validate a compatible build.
- Dockerfile checks the downloaded release archive against GitHub Release
  `SHA256SUMS`, on either linux/amd64 or linux/arm64. Its Debian base tag is
  **mutable**; this is not a hermetic source build. Record the final pushed
  **OCI image digest**, and deploy by digest, never `:latest`.
- The base image supplies T3 + Git/SSH, but **no provider CLI or login**.
  Provider installation, writable homedir needs, browser libraries and actual
  workload execution must be evaluated separately. Do not bake provider secrets.
- The existing independent [kind -> K3s CPU Job pilot](https://github.com/kvnloo/oss-factory/issues/127)
  / [draft #128](https://github.com/kvnloo/oss-factory/pull/128) tests bounded
  Kubernetes Job rendering, not T3 server identity or delegation; reuse its
  offline lessons, not its scheduler.

## Prerequisites

A disposable/opt-in **single-node** K3s context, working default StorageClass,
Tailscale Kubernetes Operator with `tailscale` IngressClass and proxy namespace
`tailscale`, MagicDNS + HTTPS certs, and correctly restricted tailnet ACLs/grants
for this workload. No Tailscale Funnel. Verify the operator's actual proxy
namespace and tailnet policy before use; this example assumes the default name.
K3s must enforce NetworkPolicy for the ingress allowlist to work. Pods do
**not** provide VM-grade isolation for untrusted code; the manifest leaves
**egress unrestricted** for the owner process. Use a dedicated cluster/node
for the first experiment, not existing household infrastructure.

## Offline proof (safe)

```sh
python3 -m pip install 'PyYAML==6.0.2'
python3 -m unittest discover -s examples/k3s-p0 -p 'test_*.py' -v
docker buildx build --platform linux/amd64 -f examples/k3s-p0/Dockerfile \
  -t ghcr.io/REPLACE_OWNER/t3-k3s-p0:0.1.3 --load .
```

For a real test, push to a registry you control, find its pushed **manifest**
digest (not the local image ID), and render a copy. The renderer rejects tags,
missing digests, YAML injection and direct modification of tracked source:

```sh
python3 examples/k3s-p0/render.py \
  --image ghcr.io/YOUR_OWNER/t3-k3s-p0@sha256:YOUR_64_LOWERCASE_HEX_DIGEST \
  --output /tmp/t3-k3s-p0.yaml
kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT apply --dry-run=client -f /tmp/t3-k3s-p0.yaml
kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT diff -f /tmp/t3-k3s-p0.yaml
```

**Inspect diff and context before a deliberate live apply.** Never point these
commands at an existing T3 state/PVC, and never reuse credentials from the
home machine. The checked-in YAML intentionally has an unpullable image token.

## Human-only deployment and acceptance

1. Confirm cluster context/namespace do not already contain any T3 resources.
   Apply the rendered YAML once: `kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT
   apply -f /tmp/t3-k3s-p0.yaml`. Check pod readiness, warnings, storage
   events and Tailscale operator ingress address. A TCP probe only proves a
   listening socket; it does not prove T3 auth, UI or provider readiness.
2. From a trusted admin shell, generate a **short-lived** pairing URL *on
   demand*, without sending it to GitHub or storing it in pod logs:
   `kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT -n t3-k3s-p0 exec
   deployment/t3-owner -- /opt/t3/t3 auth pairing create --base-dir /data/t3
   --base-url https://ACTUAL_INGRESS_FQDN --ttl 5m`.
   Pair a web/desktop/mobile client reachable via the same tailnet. Verify
   the server descriptor and its environment ID. Pairing a client does **not**
   create an OAuth peer link; linked environments beta is separately consented.
3. Before/after restart, compare
   `/data/t3/userdata/environment-id` (do not post its value publicly), T3
   project/thread data, client connection and the tailnet HTTPS endpoint.
   Restart with `kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT -n t3-k3s-p0
   rollout restart deployment/t3-owner`. Confirm the identity **and** data are
   unchanged. The fixed pod hostname mitigates `os.hostname()` drift in
   usage fingerprints (see [upstream #11849](https://github.com/pingdotgg/t3code/issues/11849)),
   but is not itself proof of identity persistence.

   For **read-only, reproducible identity evidence**, capture a local baseline
   after the first verified Ready deployment, then verify it **after** the
   human-triggered restart above (never point at the existing home cluster):

   ```sh
   python3 examples/k3s-p0/acceptance.py --context YOUR_DISPOSABLE_K3S_CONTEXT \
     --write-baseline /tmp/t3-p0-identity.json
   # Human explicitly performs rollout restart; wait for Ready before continuing.
   python3 examples/k3s-p0/acceptance.py --context YOUR_DISPOSABLE_K3S_CONTEXT \
     --check-baseline /tmp/t3-p0-identity.json
   ```

   The probe uses only read-only `kubectl get` and `kubectl exec ... cat`
   requests. It also verifies actual Pod image/labels, PVC mount, no API-token
   mount or hostPath, Service selector/port, and private Ingress backend/TLS
   routing. This closes false-green checks where an unrelated Pod or Service
   appears Ready without serving the intended T3 data. It requires
   **one Running/Ready Pod with a new Pod UID** after the
   human-triggered rollout, while checking unchanged hashed environment ID,
   PVC UID, ingress hostname and pinned image digest. Merely running the probe
   twice without restarting must fail. Each baseline is format v2; discard any
   earlier offline v1 baseline and collect a new pre-restart sample. It never
   prints the raw ID, grants access, restarts a server or applies/deletes
   resources. Keep the private identity fingerprint out of Git. A PASS is **not** proof of
   working HTTPS, ACL enforcement, client pairing, saved threads, app readiness
   or provider execution; perform the manual checks separately.

4. Verify pod/container image IDs, CPU/memory/ephemeral limits, absence of
   mounted Kubernetes tokens, tailnet policy denial from an unauthorized device,
   and **negative ingress test from a non-Tailscale namespace**. Inspect
   `kubectl logs` for inadvertent pairing tokens *privately*. Reject this
   deployment if tokens are logged. Record K3s version, CNI, storage class,
   image digest, T3 version, latency, restarts and errors.
5. Stop without deleting state: `kubectl --context YOUR_DISPOSABLE_K3S_CONTEXT
   -n t3-k3s-p0 scale deployment/t3-owner --replicas=0`.
   To remove the public-looking endpoint independently, delete the private
   `Ingress/t3-owner` in this namespace. **Do not** use
   `kubectl delete -f /tmp/t3-k3s-p0.yaml` or delete the namespace as a
   cleanup shortcut: this includes the PVC, and K3s local-path reclaim can
   permanently delete the data. Retain/archive/delete PVC only after a
   deliberate data-retention decision.

## Gated next stage

P1 will add an **external opt-in** broker that allocates separate worker
namespaces/PVCs using an idempotent lease, without changing T3 core or touching
the P0 owner. A client environment entry is not a peer authorization grant.
Require explicit `t3 environment link` OAuth consent, stable descriptor
verification, a pinned repository revision and one observed remote
`delegate_task` receipt. Upstream [#17051](https://github.com/pingdotgg/t3code/issues/17051)
still describes the record-before-launch gap: don't claim exactly-once
delegation until owner restart/lost-response tests prove it. Watch upstream
[#26475](https://github.com/pingdotgg/t3code/pull/26475) rather than using
plain `100.x` HTTP as a trust shortcut. No automatic worker enrollment into
client load balancing or shared worktrees.

**Verification status:** offline contract tests and image/K3s/tailnet/client
acceptance must be separately recorded on [downstream issue #45](https://github.com/kvnloo/t3code/issues/45).
No live K3s, Docker build, provider, device, pairing or delegation result is
implied by this example.
