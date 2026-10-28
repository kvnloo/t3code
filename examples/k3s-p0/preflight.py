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


def verify(context: str, runner=subprocess.run) -> None:
    """Check only prerequisites safe to prove using GET requests."""
    def read(*args, optional_absent=False):
        return query(context, *args, optional_absent=optional_absent,
                     runner=runner)

    version = read("get", "--raw=/version")
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:[+\-].*)?",
                         version.get("gitVersion", ""))
    if not match or tuple(map(int, match.groups()[:2])) < (1, 28):
        raise PreflightError("Kubernetes server must be version 1.28 or newer")

    nodes = read("get", "nodes", "-o", "json").get("items")
    if not isinstance(nodes, list) or len(nodes) != 1:
        raise PreflightError("P0 proof requires exactly one disposable test node")
    node = nodes[0]
    if not isinstance(node, dict) or node.get("spec", {}).get("unschedulable") is True:
        raise PreflightError("P0 test node is unschedulable")
    if any(t.get("effect") in ("NoSchedule", "NoExecute")
           for t in node.get("spec", {}).get("taints", [])):
        raise PreflightError("P0 test node has an untolerated scheduling taint")
    if not any(c.get("type") == "Ready" and c.get("status") == "True"
               for c in node.get("status", {}).get("conditions", [])):
        raise PreflightError("P0 test node is not Ready")

    namespace = read("get", "namespace", "t3-k3s-p0", "--ignore-not-found",
                     "-o", "json", optional_absent=True)
    if namespace is not None:
        raise PreflightError("P0 namespace already exists; refuse possible overwrite")

    tail_ns = read("get", "namespace", "tailscale", "-o", "json")
    if tail_ns.get("metadata", {}).get("name") != "tailscale":
        raise PreflightError("default Tailscale proxy namespace is not present")
    ingress_class = read("get", "ingressclass", "tailscale", "-o", "json")
    if ingress_class.get("spec", {}).get("controller") != "tailscale.com/ts-ingress":
        raise PreflightError("Tailscale IngressClass controller does not match")

    storage = read("get", "storageclasses", "-o", "json").get("items")
    if not isinstance(storage, list):
        raise PreflightError("StorageClass listing unavailable")
    defaults = [item for item in storage if item.get("metadata", {}).get(
        "annotations", {}).get("storageclass.kubernetes.io/is-default-class") == "true"]
    if len(defaults) != 1 or not defaults[0].get("metadata", {}).get("name"):
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
