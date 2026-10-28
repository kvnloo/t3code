"""Offline P0 security and shape regression checks (requires PyYAML)."""

import copy
import importlib.util
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("k3s_p0_render", ROOT / "render.py")
assert spec and spec.loader
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
DOCS = list(yaml.safe_load_all((ROOT / "k3s.yaml").read_text(encoding="utf-8")))
OBJECTS = {doc["kind"]: doc for doc in DOCS}


def assert_p0_contract(objects: dict) -> None:
    expected = {"Namespace", "ResourceQuota", "ServiceAccount",
                "PersistentVolumeClaim", "Deployment", "Service", "Ingress", "NetworkPolicy"}
    assert set(objects) == expected, "unexpected cluster resources"
    ns = objects["Namespace"]
    assert ns["metadata"]["name"] == "t3-k3s-p0"
    assert ns["metadata"]["labels"]["pod-security.kubernetes.io/enforce"] == "restricted"
    for kind, doc in objects.items():
        if kind != "Namespace":
            assert doc["metadata"]["namespace"] == "t3-k3s-p0"
    quota = objects["ResourceQuota"]["spec"]["hard"]
    assert quota["pods"] == "1"
    assert quota["persistentvolumeclaims"] == "1"
    assert quota["requests.storage"] == "20Gi"
    sa = objects["ServiceAccount"]
    assert sa["automountServiceAccountToken"] is False
    pvc = objects["PersistentVolumeClaim"]
    assert pvc["spec"]["accessModes"] == ["ReadWriteOnce"]
    dep = objects["Deployment"]["spec"]
    assert dep["replicas"] == 1
    assert dep["strategy"]["type"] == "Recreate"
    pod = dep["template"]["spec"]
    assert pod["serviceAccountName"] == "t3-p0"
    assert pod["automountServiceAccountToken"] is False
    assert pod["hostname"] == "t3-owner"
    assert pod["securityContext"]["runAsNonRoot"] is True
    assert pod["securityContext"]["runAsUser"] == 10001
    assert pod["securityContext"]["fsGroup"] == 10001
    assert pod["securityContext"]["seccompProfile"]["type"] == "RuntimeDefault"
    assert len(pod["containers"]) == 1
    app = pod["containers"][0]
    assert app["image"] == renderer.PLACEHOLDER
    assert app["imagePullPolicy"] == "IfNotPresent"
    assert app["securityContext"]["allowPrivilegeEscalation"] is False
    assert app["securityContext"]["readOnlyRootFilesystem"] is True
    assert app["securityContext"]["capabilities"]["drop"] == ["ALL"]
    assert app["resources"]["limits"]["cpu"] == "2"
    assert app["resources"]["limits"]["memory"] == "4Gi"
    assert any(v["mountPath"] == "/data" for v in app["volumeMounts"])
    assert any(v["persistentVolumeClaim"]["claimName"] == "t3-p0-data" for v in pod["volumes"]
               if "persistentVolumeClaim" in v)
    assert all("hostPath" not in v for v in pod["volumes"])
    assert "privileged" not in app["securityContext"]
    service = objects["Service"]["spec"]
    assert service["type"] == "ClusterIP"
    assert service["ports"][0]["targetPort"] == "http"
    ingress = objects["Ingress"]
    assert ingress["spec"]["ingressClassName"] == "tailscale"
    assert ingress["spec"]["tls"][0]["hosts"] == ["t3-k3s-p0"]
    assert "tailscale.com/funnel" not in ingress["metadata"].get("annotations", {})
    assert "rules" not in ingress["spec"]  # default backend avoids public Host assumptions
    policy = objects["NetworkPolicy"]["spec"]
    assert policy["policyTypes"] == ["Ingress"]
    assert policy["podSelector"]["matchLabels"] == {"app": "t3-owner"}
    assert policy["ingress"][0]["from"][0]["namespaceSelector"]["matchLabels"] == {
        "kubernetes.io/metadata.name": "tailscale"
    }
    assert policy["ingress"][0]["ports"] == [{"protocol": "TCP", "port": 3773}]


class P0ContractTest(unittest.TestCase):
    def test_safe_declarative_template(self):
        assert_p0_contract(OBJECTS)

    def test_rejects_public_ingress_mutation(self):
        mutated = copy.deepcopy(OBJECTS)
        mutated["Ingress"]["metadata"]["annotations"] = {"tailscale.com/funnel": "true"}
        with self.assertRaises(AssertionError):
            assert_p0_contract(mutated)

    def test_rejects_unsafe_pod_mutation(self):
        mutated = copy.deepcopy(OBJECTS)
        mutated["Deployment"]["spec"]["template"]["spec"]["containers"][0][
            "securityContext"]["allowPrivilegeEscalation"] = True
        with self.assertRaises(AssertionError):
            assert_p0_contract(mutated)

    def test_requires_digest_and_one_placeholder(self):
        valid = "ghcr.io/example/t3-p0@sha256:" + "a" * 64
        source = (ROOT / "k3s.yaml").read_text(encoding="utf-8")
        result = renderer.render(source, valid)
        self.assertEqual(result.count(valid), 1)
        self.assertNotIn(renderer.PLACEHOLDER, result)
        for invalid in (
            "ghcr.io/example/t3-p0:latest",
            "ghcr.io/example/t3-p0@sha256:not-a-digest",
            "ghcr.io/example/t3-p0@sha256:" + "A" * 64,
            "ghcr.io/example/t3-p0@sha256:" + "a" * 64 + "\nkind: Pod",
            "ghcr.io/../t3-p0@sha256:" + "a" * 64,
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    renderer.render(source, invalid)
        with self.assertRaises(ValueError):
            renderer.render("no placeholder", valid)
        with self.assertRaises(ValueError):
            renderer.render(renderer.PLACEHOLDER * 2, valid)

    def test_docker_build_pins_t3_release_and_checks_archive(self):
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("ARG T3_VERSION=0.1.3", dockerfile)
        self.assertIn("/SHA256SUMS", dockerfile)
        self.assertIn("sha256sum --check", dockerfile)
        self.assertIn("USER 10001:10001", dockerfile)
        self.assertIn('"start", "--no-browser"', dockerfile)
        self.assertNotIn('"serve",', dockerfile)


if __name__ == "__main__":
    unittest.main()
