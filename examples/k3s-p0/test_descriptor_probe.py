"""Offline tests for the P0 read-only, unauthenticated tailnet descriptor probe."""

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import ssl
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("descriptor_probe", ROOT / "descriptor_probe.py")
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

HOST = "t3-k3s-p0.sample-tailnet.ts.net"
IDENTITY_HASH = hashlib.sha256(b"stable-id").hexdigest()


class FakeResponse:
    def __init__(self, status=200, content_type="application/json", body=None):
        self.status = status
        self.content_type = content_type
        self.body = body if body is not None else json.dumps(
            {"environmentId": "stable-id"}).encode()

    def getheader(self, name, default=""):
        return self.content_type

    def read(self, count):
        assert count == 65537
        return self.body[:count]


class FakeTlsConnection:
    def __init__(self, host, timeout, context, response=None):
        assert host == HOST and timeout == 10
        assert context.check_hostname
        assert context.verify_mode == ssl.CERT_REQUIRED
        self.response = response if response is not None else FakeResponse()
        self.calls = []
        self.closed = False

    def close(self):
        self.closed = True

    def request(self, *args, **kwargs):
        self.calls.append((args, kwargs))

    def getresponse(self):
        return self.response


def connection_for(response=None, error=None):
    def connect(host, timeout, context):
        if error is not None:
            raise error
        return FakeTlsConnection(host, timeout, context, response)
    return connect


class P0TlsDescriptorTest(unittest.TestCase):
    def test_checked_https_route_and_identity(self):
        probe.verify_private_descriptor(HOST, IDENTITY_HASH, connection_for(
            FakeResponse(content_type="application/json; charset=utf-8")))

    def test_get_is_unauthenticated_and_does_not_redirect(self):
        connection = FakeTlsConnection(HOST, 10, ssl.create_default_context())
        probe.verify_private_descriptor(HOST, IDENTITY_HASH, lambda *args, **kw: connection)
        self.assertEqual(connection.calls, [
            (("GET", "/.well-known/t3/environment"), {"headers": {
                "Accept": "application/json", "Cache-Control": "no-store"}}),
        ])
        with self.assertRaisesRegex(probe.EvidenceError, "non-200"):
            probe.verify_private_descriptor(HOST, IDENTITY_HASH,
                                            connection_for(FakeResponse(status=302)))

    def test_plain_connection_closes_after_success_and_http_error(self):
        # stdlib HTTPSConnection has close(), not __enter__/__exit__.
        success = FakeTlsConnection(HOST, 10, ssl.create_default_context())
        self.assertFalse(hasattr(success, "__enter__"))
        probe.verify_private_descriptor(HOST, IDENTITY_HASH,
                                        lambda *args, **kwargs: success)
        self.assertTrue(success.closed)

        failure = FakeTlsConnection(HOST, 10, ssl.create_default_context(),
                                    response=FakeResponse(status=503))
        with self.assertRaisesRegex(probe.EvidenceError, "non-200"):
            probe.verify_private_descriptor(HOST, IDENTITY_HASH,
                                            lambda *args, **kwargs: failure)
        self.assertTrue(failure.closed)

    def test_rejects_misdirected_hosts_and_invalid_hash(self):
        for host in ("http://" + HOST, "t3-k3s-p0..ts.net",
                     "t3-k3s-p0.a.ts.net/secret", "t3-k3s-p0.a.ts.net.evil",
                     "t3-k3s-p0.-a.ts.net", "t3-k3s-p0.a-.ts.net",
                     "evil.tailnet.ts.net", "t3-k3s-p0.☺.ts.net"):
            with self.subTest(host=host), self.assertRaises(probe.EvidenceError):
                probe.verify_private_descriptor(host, IDENTITY_HASH, connection_for())
        with self.assertRaises(probe.EvidenceError):
            probe.verify_private_descriptor(HOST, "bad-hash", connection_for())

    def test_rejects_bad_http_body_and_mismatched_identity(self):
        cases = [
            FakeResponse(status=401), FakeResponse(status=500),
            FakeResponse(content_type="text/html"), FakeResponse(body=b"not-json"),
            FakeResponse(body=b"[]"), FakeResponse(body=b"{}"),
            FakeResponse(body=b'{"environmentId": "wrong"}'),
            FakeResponse(body=b"a" * 65537),
        ]
        for index, response in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(probe.EvidenceError):
                probe.verify_private_descriptor(HOST, IDENTITY_HASH, connection_for(response))

    def test_rejects_tls_connect_timeout_and_cert_failure(self):
        for error in (OSError("offline"), TimeoutError(), ssl.SSLError("certificate")):
            with self.subTest(error=type(error).__name__):
                with self.assertRaisesRegex(probe.EvidenceError, "unreachable or untrusted"):
                    probe.verify_private_descriptor(HOST, IDENTITY_HASH,
                                                    connection_for(error=error))

    def test_requires_private_v3_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "evidence.json"
            baseline = {"format": "t3-k3s-p0-identity-v3", "podUid": "pod-1",
                        "pvcUid": "pvc-1", "pvUid": "pv-1",
                         "pvReclaimPolicy": "Delete", "endpointHost": HOST,
                        "environmentIdHash": IDENTITY_HASH}
            path.write_text(json.dumps(baseline), encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(probe.read_baseline(path), (HOST, IDENTITY_HASH))
            path.chmod(0o644)
            with self.assertRaisesRegex(probe.EvidenceError, "private"):
                probe.read_baseline(path)
            path.chmod(0o600)
            baseline["pvUid"] = ""
            path.write_text(json.dumps(baseline), encoding="utf-8")
            with self.assertRaisesRegex(probe.EvidenceError, "PV"):
                probe.read_baseline(path)
            baseline["pvUid"] = "pv-1"
            baseline["format"] = "t3-k3s-p0-identity-v2"
            path.write_text(json.dumps(baseline), encoding="utf-8")
            with self.assertRaisesRegex(probe.EvidenceError, "format"):
                probe.read_baseline(path)
            path.write_bytes(b"x" * 4097)
            with self.assertRaisesRegex(probe.EvidenceError, "baseline"):
                probe.read_baseline(path)

    def test_rejects_symlink_baseline(self):
        with tempfile.TemporaryDirectory() as temp:
            original = Path(temp) / "original.json"
            alias = Path(temp) / "evidence.json"
            original.write_text("{}", encoding="utf-8")
            original.chmod(0o600)
            alias.symlink_to(original)
            with self.assertRaises(OSError):
                probe.read_baseline(alias)


    @unittest.skipUnless(hasattr(os, "mkfifo") and hasattr(os, "O_NONBLOCK"),
                         "requires POSIX nonblocking FIFO support")
    def test_rejects_fifo_baseline_without_blocking(self):
        # A mode-0600 FIFO passes the permissions check, but a blocking open
        # never reaches fstat unless another process opens the write end.
        # Test in a subprocess so a regression fails on a timeout, not a hang.
        with tempfile.TemporaryDirectory() as temp:
            fifo = Path(temp) / "evidence.fifo"
            os.mkfifo(fifo, 0o600)
            script = """
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("probe", sys.argv[1])
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
try:
    probe.read_baseline(Path(sys.argv[2]))
except probe.EvidenceError:
    sys.exit(0)
sys.exit(2)
"""
            completed = subprocess.run(
                [sys.executable, "-c", script, str(ROOT / "descriptor_probe.py"), str(fifo)],
                check=False, capture_output=True, text=True, timeout=2,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == "__main__":
    unittest.main()
