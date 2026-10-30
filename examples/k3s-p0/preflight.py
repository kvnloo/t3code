#!/usr/bin/env python3
"""Read-only suitability gate for a *disposable* K3s/Tailscale P0 test cluster.

This intentionally cannot prove cluster ownership, CNI NetworkPolicy enforcement,
tailnet ACLs, certificate issuance, or client readiness. Never applies resources.
"""

import argparse
import json
import re
import subprocess


class PreflightError(RuntimeError):
    """The selected cluster is not yet eligible for the P0 acceptance test."""


def query(context: str, *args: str, optional_absent: bool = False,
          runner=subprocess.run):
    if (not context or context != context.strip() or context.startswith("-")
            or any(c in context for c in "\r\n\x00")):
        raise PreflightError("provide an explicit, valid kubectl context")
    command = ["kubectl", "--context", context, "--request-timeout=10s", *args]
    try:
        completed = runner(command, capture_output=True, text=True,
                           timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PreflightError("read-only Kubernetes query unavailable") from exc
    if completed.returncode:
        # Error text may reveal cluster endpoints or credentials: never repeat it.
        raise PreflightError("read-only Kubernetes query rejected")
    if not completed.stdout.strip() and optional_absent:
        return None
    try:
        value = json.loads(completed.stdout)
    except (ValueError, TypeError) as exc:
        raise PreflightError("Kubernetes returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise PreflightError("Kubernetes returned an unexpected object")
    return value


def require_object(value, label: str) -> dict:
    """Reject malformed resource fields without exposing response contents."""
    if not isinstance(value, dict):
        raise PreflightError(f"Kubernetes returned malformed {label}")
    return value


def verify(context: str, runner=subprocess.run) -> None:
    """Check only prerequisites safe to prove using GET requests."""
    def read(*args, optional_absent=False):
        return query(context, *args, optional_absent=optional_absent,
                     runner=runner)

    version = read("get", "--raw=/version")
    git_version = version.get("gitVersion")
    # Other Kubernetes distributions can pass every remaining prerequisite.
    # This P0 proof must target a real, stable K3s build, not a generic cluster.
    match = (re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)\+k3s[1-9]\d*", git_version)
             if isinstance(git_version, str) else None)
    if not match or tuple(map(int, match.groups()[:2])) < (1, 28):
        raise PreflightError("K3s server must be version 1.28+ with a stable +k3sN build")

    nodes = read("get", "nodes", "-o", "json").get("items")
    if not isinstance(nodes, list) or len(nodes) != 1:
        raise PreflightError("P0 proof requires exactly one disposable test node")
    node = require_object(nodes[0], "Node")
    spec = require_object(node.get("spec"), "Node spec")
    status = require_object(node.get("status"), "Node status")
    if spec.get("unschedulable") not in (None, False):
        raise PreflightError("P0 test node is unschedulable")
    taints = spec.get("taints", [])
    if not isinstance(taints, list) or any(not isinstance(t, dict) for t in taints):
        raise PreflightError("Kubernetes returned malformed Node taints")
    if any(t.get("effect") in ("NoSchedule", "NoExecute") for t in taints):
        raise PreflightError("P0 test node has an untolerated scheduling taint")
    conditions = status.get("conditions")
    if not isinstance(conditions, list) or any(not isinstance(c, dict) for c in conditions):
        raise PreflightError("Kubernetes returned malformed Node conditions")
    if not any(c.get("type") == "Ready" and c.get("status") == "True"
               for c in conditions):
        raise PreflightError("P0 test node is not Ready")

    namespace = read("get", "namespace", "t3-k3s-p0", "--ignore-not-found",
                     "-o", "json", optional_absent=True)
    if namespace is not None:
        raise PreflightError("P0 namespace already exists; refuse possible overwrite")

    tail_ns = read("get", "namespace", "tailscale", "-o", "json")
    if require_object(tail_ns.get("metadata"), "Tailscale Namespace metadata").get("name") != "tailscale":
        raise PreflightError("default Tailscale proxy namespace is not present")
    ingress_class = read("get", "ingressclass", "tailscale", "-o", "json")
    if require_object(ingress_class.get("spec"), "IngressClass spec").get("controller") != "tailscale.com/ts-ingress":
        raise PreflightError("Tailscale IngressClass controller does not match")

    storage = read("get", "storageclasses", "-o", "json").get("items")
    if not isinstance(storage, list):
        raise PreflightError("StorageClass listing unavailable")
    defaults = []
    for item in storage:
        meta = require_object(require_object(item, "StorageClass").get("metadata"),
                              "StorageClass metadata")
        annotations = meta.get("annotations", {})
        if not isinstance(annotations, dict):
            raise PreflightError("Kubernetes returned malformed StorageClass annotations")
        if annotations.get("storageclass.kubernetes.io/is-default-class") == "true":
            defaults.append(meta)
    if len(defaults) != 1 or not defaults[0].get("name"):
        raise PreflightError("P0 requires exactly one named default StorageClass")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, help="explicit disposable K3s context")
    args = parser.parse_args()
    try:
        verify(args.context)
    except PreflightError as exc:
        parser.exit(1, f"FAIL: {exc}\n")
    print("PASS: read-only P0 Kubernetes prerequisite checks")
    print("NOT RUN: disposable-cluster ownership, NetworkPolicy dataplane, tailnet TLS/ACL, K3s apply or T3 client")


if __name__ == "__main__":
    main()
