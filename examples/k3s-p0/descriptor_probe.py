#!/usr/bin/env python3
"""Opt-in, credential-free HTTPS identity check from an authorized tailnet client.

Run after acceptance.py saved a PRIVATE v3 Kubernetes identity baseline.
This does not read user tokens or grant access, and it never applies to K3s.
"""

import argparse
from contextlib import closing
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import stat


class EvidenceError(RuntimeError):
    """Untrusted route or invalid persisted P0 baseline."""


def verify_private_descriptor(hostname: str, expected_id_hash: str,
                              connect=http.client.HTTPSConnection) -> None:
    """Verify the real HTTPS route answers as the persisted T3 environment.

    No auth is sent. TLS trust/hostname validation are mandatory. This proves
    a read-only descriptor on one private origin, not pairing, ACLs, or a UI.
    """
    if (not isinstance(hostname, str)
            or not re.fullmatch(r"t3-k3s-p0\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net", hostname)
            or not re.fullmatch(r"[a-f0-9]{64}", expected_id_hash)):
        raise EvidenceError("private HTTPS target or expected identity is invalid")
    try:
        with closing(connect(hostname, timeout=10, context=ssl.create_default_context())) as connection:
            connection.request("GET", "/.well-known/t3/environment", headers={
                "Accept": "application/json", "Cache-Control": "no-store",
            })
            response = connection.getresponse()
            if response.status != 200:
                raise EvidenceError("private HTTPS descriptor returned non-200 status")
            content_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                raise EvidenceError("private HTTPS descriptor returned non-JSON content type")
            payload = response.read(65537)
            if len(payload) > 65536:
                raise EvidenceError("private HTTPS descriptor exceeds response size limit")
    except (OSError, TimeoutError, ssl.SSLError, http.client.HTTPException) as exc:
        raise EvidenceError("private HTTPS descriptor unreachable or untrusted") from exc
    try:
        descriptor = json.loads(payload)
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise EvidenceError("private HTTPS descriptor contains invalid JSON") from exc
    reported_id = descriptor.get("environmentId") if isinstance(descriptor, dict) else None
    if (not isinstance(reported_id, str) or not reported_id
            or len(reported_id) > 512 or "\n" in reported_id or "\r" in reported_id
            or hashlib.sha256(reported_id.encode("utf-8")).hexdigest() != expected_id_hash):
        raise EvidenceError("private HTTPS descriptor environment identity mismatch")


def read_baseline(path: Path) -> tuple[str, str]:
    """Read the existing 0600 v3 baseline, not live credentials or T3 data."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(path, flags), "rb") as handle:
        metadata = os.fstat(handle.fileno())
        if (not stat.S_ISREG(metadata.st_mode)
                or stat.S_IMODE(metadata.st_mode) & 0o077
                or metadata.st_size > 4096):
            raise EvidenceError("baseline must be a private, regular, bounded file")
        data = handle.read(4097)
    if len(data) > 4096:
        raise EvidenceError("baseline exceeds response size limit")
    try:
        record = json.loads(data)
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise EvidenceError("baseline JSON is invalid") from exc
    if not isinstance(record, dict) or record.get("format") != "t3-k3s-p0-identity-v3":
        raise EvidenceError("baseline format mismatch; collect a fresh v3 baseline")
    if (not record.get("podUid") or not record.get("pvcUid")
            or not record.get("pvUid")
            or record.get("pvReclaimPolicy") not in ("Retain", "Delete")):
        raise EvidenceError("baseline is missing Pod/PVC/PV evidence")
    return record.get("endpointHost"), record.get("environmentIdHash")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True,
                        help="local mode-0600 acceptance.py v3 baseline; keep outside Git")
    args = parser.parse_args()
    try:
        host, identity_hash = read_baseline(args.baseline)
        verify_private_descriptor(host, identity_hash)
        print("PASS: trusted tailnet HTTPS descriptor matches persisted T3 environment identity")
        print("NOT RUN: tailnet ACL negative control, client pairing, thread data, or delegation")
    except (EvidenceError, OSError, TypeError) as exc:
        parser.exit(1, f"FAIL: {exc}\n")


if __name__ == "__main__":
    main()
