"""Read-only P0 preflight tests; no kubectl process or cluster required."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("p0_preflight", ROOT / "preflight.py")
assert spec and spec.loader
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

RESPONSES = {
    ("get", "--raw=/version"): {"gitVersion": "v1.37.1+k3s1"},
    ("get", "nodes", "-o", "json"): {"items": [{
        "spec": {"unschedulable": False},
        "status": {"conditions": [{"type": "Ready", "status": "True"}]}
    }]},
    ("get", "namespace", "t3-k3s-p0", "--ignore-not-found", "-o", "json"): None,
    ("get", "namespace", "tailscale", "-o", "json"): {"metadata": {"name": "tailscale"}},
    ("get", "ingressclass", "tailscale", "-o", "json"): {
        "spec": {"controller": "tailscale.com/ts-ingress"}
    },
    ("get", "storageclasses", "-o", "json"): {"items": [{"metadata": {
        "name": "local-path", "annotations": {
            "storageclass.kubernetes.io/is-default-class": "true"
        }
    }}]},
}


def fake_run(mapping, *, error=None):
    def run(command, capture_output, text, timeout, check):
        assert command[:4] == ["kubectl", "--context", "isolated-k3s", "--request-timeout=10s"]
        assert all(x not in command for x in ("apply", "delete", "patch", "exec", "create", "rollout", "get secrets"))
        assert capture_output and text and timeout == 20 and check is False
        if error:
            raise error
        key = tuple(command[4:])
        assert key in mapping, f"unexpected kubectl query: {key}"
        value = mapping[key]
        return subprocess.CompletedProcess(command, 0, "" if value is None else json.dumps(value), "")
    return run


class P0PreflightTests(unittest.TestCase):
    def test_passes_disposable_ready_single_node(self):
        preflight.verify("isolated-k3s", runner=fake_run(RESPONSES))

    def test_rejects_non_k3s_and_malformed_server_versions(self):
        # A generic Kubernetes cluster can meet every other read-only check.
        # This P0 proof is explicitly K3s-only; never report it as K3s.
        for version in ("v1.37.1", "v1.37.1+k0s1", "v1.37.1+k3s",
                        "v1.27.9+k3s1", None, 137):
            mapping = copy.deepcopy(RESPONSES)
            mapping[("get", "--raw=/version")] = {"gitVersion": version}
            with self.subTest(version=version), self.assertRaises(preflight.PreflightError):
                preflight.verify("isolated-k3s", runner=fake_run(mapping))

    def test_rejects_missing_or_invalid_context(self):
        for context in ("", "-danger", " isolated-k3s", "isolated-k3s\n", "a\x00b"):
            with self.subTest(context=repr(context)), self.assertRaises(preflight.PreflightError):
                preflight.verify(context, runner=fake_run(RESPONSES))

    def test_rejects_conflicting_cluster_and_prerequisites(self):
        scenarios = [
            (("get", "--raw=/version"), {"gitVersion": "v1.27.9+k3s1"}),
            (("get", "nodes", "-o", "json"), {"items": []}),
            (("get", "nodes", "-o", "json"), {"items": [{"spec": {}, "status": {}}]}),
            (("get", "nodes", "-o", "json"), {"items": [{"spec": {"taints": [{"effect": "NoSchedule"}]}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}]}),
            (("get", "namespace", "t3-k3s-p0", "--ignore-not-found", "-o", "json"), {"metadata": {"name": "t3-k3s-p0"}}),
            (("get", "namespace", "tailscale", "-o", "json"), {"metadata": {"name": "another"}}),
            (("get", "ingressclass", "tailscale", "-o", "json"), {"spec": {"controller": "nginx"}}),
            (("get", "storageclasses", "-o", "json"), {"items": []}),
            (("get", "storageclasses", "-o", "json"), {"items": [{"metadata": {"name": "a", "annotations": {"storageclass.kubernetes.io/is-default-class": "true"}}}, {"metadata": {"name": "b", "annotations": {"storageclass.kubernetes.io/is-default-class": "true"}}}]}),
        ]
        for key, value in scenarios:
            values = copy.deepcopy(RESPONSES)
            values[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(preflight.PreflightError):
                preflight.verify("isolated-k3s", runner=fake_run(values))

    def test_fails_closed_on_query_error_and_malformed_json(self):
        with self.assertRaisesRegex(preflight.PreflightError, "unavailable"):
            preflight.verify("isolated-k3s", runner=fake_run(RESPONSES, error=OSError("denied")))

        def bad_json(command, capture_output, text, timeout, check):
            return subprocess.CompletedProcess(command, 0, "not-json", "")
        with self.assertRaisesRegex(preflight.PreflightError, "invalid JSON"):
            preflight.verify("isolated-k3s", runner=bad_json)

        def error_json(command, capture_output, text, timeout, check):
            return subprocess.CompletedProcess(command, 1, "", "private credential info")
        with self.assertRaisesRegex(preflight.PreflightError, "query rejected") as exc:
            preflight.verify("isolated-k3s", runner=error_json)
        self.assertNotIn("credential", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
