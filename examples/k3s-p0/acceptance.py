#!/usr/bin/env python3
"""Read-only, opt-in K3s P0 identity snapshot before/after a HUMAN restart.

No cluster mutations, pairing grants, or network exposure. Never prints a raw
T3 environment ID. This does not establish functional client/agent readiness.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

NAMESPACE = "t3-k3s-p0"


class EvidenceError(RuntimeError):
    """The observed cluster does not match the bounded P0 acceptance contract."""


def kubectl(context: str, *args: str) -> str:
    if not context.strip() or context.startswith("-"):
        raise EvidenceError("an explicit kubectl context is required")
    command = ["kubectl", "--context", context, *args]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EvidenceError("kubectl read-only query failed or timed out") from exc
    if result.returncode:
        # Some kubectl errors include sensitive data; do not echo stderr.
        raise EvidenceError("kubectl read-only query failed; inspect locally")
    return result.stdout


def collect(context: str, read=kubectl) -> dict[str, str]:
    def get(kind: str, name: str) -> dict:
        try:
            return json.loads(read(context, "-n", NAMESPACE, "get", kind, name, "-o", "json"))
        except (json.JSONDecodeError, TypeError) as exc:
            raise EvidenceError("invalid kubectl JSON") from exc

    deployment = get("deployment", "t3-owner")
    pod_spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    if (deployment.get("spec", {}).get("replicas") != 1
            or deployment.get("status", {}).get("readyReplicas") != 1
            or pod_spec.get("automountServiceAccountToken") is not False):
        raise EvidenceError("P0 deployment must have one Ready replica without an API token")
    containers = pod_spec.get("containers", [])
    if len(containers) != 1 or "@sha256:" not in containers[0].get("image", ""):
        raise EvidenceError("P0 deployment must use exactly one digest-pinned container")

    pvc = get("pvc", "t3-p0-data")
    if pvc.get("status", {}).get("phase") != "Bound" or not pvc.get("metadata", {}).get("uid"):
        raise EvidenceError("P0 PVC is not Bound or missing its UID")
    service = get("service", "t3-owner")
    if service.get("spec", {}).get("type") != "ClusterIP":
        raise EvidenceError("P0 Service is not private ClusterIP")
    ingress = get("ingress", "t3-owner")
    if ingress.get("spec", {}).get("ingressClassName") != "tailscale":
        raise EvidenceError("P0 Ingress is not served by Tailscale")
    if ingress.get("metadata", {}).get("annotations", {}).get("tailscale.com/funnel") == "true":
        raise EvidenceError("Tailscale Funnel must stay disabled")
    addresses = ingress.get("status", {}).get("loadBalancer", {}).get("ingress", [])
    if not addresses:
        raise EvidenceError("Tailscale Ingress has no ready address")
    hostname = addresses[0].get("hostname", "")
    if not hostname.endswith(".ts.net"):
        raise EvidenceError("Tailscale Ingress does not report a MagicDNS hostname")

    # Explicitly read the owner's current identity; never log/print it.
    raw_id = read(context, "-n", NAMESPACE, "exec", "deployment/t3-owner", "--",
                  "cat", "/data/t3/userdata/environment-id").strip()
    if not raw_id or len(raw_id) > 512 or "\n" in raw_id or "\r" in raw_id:
        raise EvidenceError("missing or malformed persisted T3 environment ID")
    return {
        "format": "t3-k3s-p0-identity-v1",
        "environmentIdHash": hashlib.sha256(raw_id.encode("utf-8")).hexdigest(),
        "pvcUid": pvc["metadata"]["uid"],
        "endpointHost": hostname,
        "deploymentImage": containers[0]["image"],
    }


def write_baseline(path: Path, record: dict) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(record, handle, sort_keys=True)
        handle.write("\n")


def check_baseline(path: Path, record: dict) -> None:
    flags = os.O_RDONLY | (getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(os.open(path, flags), encoding="utf-8") as handle:
        old = json.load(handle)
    if old.get("format") != record["format"]:
        raise EvidenceError("baseline format mismatch")
    for field in ("environmentIdHash", "pvcUid", "endpointHost"):
        if old.get(field) != record[field]:
            raise EvidenceError(f"P0 restart changed {field}; do not claim persistence")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True, help="explicit disposable K3s context")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--write-baseline", type=Path)
    modes.add_argument("--check-baseline", type=Path)
    args = parser.parse_args()
    try:
        record = collect(args.context)
        if args.write_baseline:
            write_baseline(args.write_baseline, record)
            print("PASS: P0 object preflight observed; baseline saved with mode 0600")
        else:
            check_baseline(args.check_baseline, record)
            print("PASS: persisted environment ID, PVC and private hostname unchanged")
        print("NOT RUN: client pairing, auth, data/thread restoration, provider and policy enforcement")
    except (EvidenceError, OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"FAIL: {exc}\n")


if __name__ == "__main__":
    main()
