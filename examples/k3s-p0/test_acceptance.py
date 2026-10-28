"""Offline fake-kubectl tests for read-only P0 cluster evidence collection."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("acceptance", ROOT / "acceptance.py")
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fake_reads(identity="stable-id", ready=True, host="t3-k3s-p0.tailxxx.ts.net", funnel=False):
    docs = {
        "deployment": {"spec": {"replicas": 1, "template": {"spec": {
            "automountServiceAccountToken": False,
            "containers": [{"image": "ghcr.io/me/t3@sha256:" + "a" * 64}]}}},
            "status": {"readyReplicas": 1 if ready else 0}},
        "pvc": {"metadata": {"uid": "stable-pvc-uid"}, "status": {"phase": "Bound"}},
        "service": {"spec": {"type": "ClusterIP"}},
        "ingress": {"metadata": {"annotations": {"tailscale.com/funnel": "true"} if funnel else {}},
                    "spec": {"ingressClassName": "tailscale"},
                    "status": {"loadBalancer": {"ingress": [{"hostname": host}]}}},
    }
    calls = []
    def read(context, *args):
        calls.append((context, args))
        assert context == "disposable-test"
        assert "apply" not in args and "delete" not in args and "rollout" not in args
        if "exec" in args:
            return identity + "\n"
        return json.dumps(docs[args[3]])
    return read, calls


class P0EvidenceTest(unittest.TestCase):
    def test_same_id_survives_restart_without_leaking_raw_id(self):
        reader, calls = fake_reads()
        before = module.collect("disposable-test", reader)
        after = module.collect("disposable-test", reader)
        self.assertNotIn("stable-id", json.dumps(before))
        self.assertEqual(before, after)
        self.assertEqual(len(calls), 10)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, before)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            module.check_baseline(path, after)
            with self.assertRaises(FileExistsError):
                module.write_baseline(path, before)

    def test_change_in_environment_id_rejected(self):
        first = module.collect("disposable-test", fake_reads("first")[0])
        second = module.collect("disposable-test", fake_reads("second")[0])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, first)
            with self.assertRaisesRegex(module.EvidenceError, "environmentIdHash"):
                module.check_baseline(path, second)

    def test_changed_pvc_or_endpoint_rejected(self):
        original = module.collect("disposable-test", fake_reads()[0])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, original)
            for change in ({"pvcUid": "new"}, {"endpointHost": "new.tail.ts.net"}):
                with self.assertRaises(module.EvidenceError):
                    module.check_baseline(path, {**original, **change})

    def test_not_ready_and_funnel_rejected(self):
        for kwargs in ({"ready": False}, {"funnel": True}, {"host": "example.org"}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(module.EvidenceError):
                    module.collect("disposable-test", fake_reads(**kwargs)[0])


if __name__ == "__main__":
    unittest.main()
