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


def fake_reads(identity="stable-id", ready=True, host="t3-k3s-p0.tailxxx.ts.net",
               funnel=False, pod_uid="pod-1", pod_ready=True, pod_count=1, deleting=False,
               image=None):
    docs = {
        "deployment": {"metadata": {"generation": 7},
            "spec": {"replicas": 1, "template": {"spec": {
                "automountServiceAccountToken": False,
                "containers": [{"name": "t3", "image": image or "ghcr.io/me/t3@sha256:" + "a" * 64}]}}},
            "status": {"readyReplicas": 1 if ready else 0,
                       "availableReplicas": 1 if ready else 0,
                       "updatedReplicas": 1 if ready else 0,
                       "observedGeneration": 7}},
        "pods": {"items": [{
            "metadata": {"name": "t3-owner-test", "uid": pod_uid,
                         "labels": {"app": "t3-owner"},
                         **({"deletionTimestamp": "2026-10-28T00:00:00Z"} if deleting else {})},
            "spec": {"automountServiceAccountToken": False,
                     "containers": [{"name": "t3",
                                     "image": image or "ghcr.io/me/t3@sha256:" + "a" * 64,
                                     "volumeMounts": [{"name": "data", "mountPath": "/data"}]}],
                     "volumes": [{"name": "data", "persistentVolumeClaim": {
                         "claimName": "t3-p0-data"}}]},
            "status": {"phase": "Running", "podIP": "10.42.0.9",
                       "podIPs": [{"ip": "10.42.0.9"}],
                       "containerStatuses": [
                {"name": "t3", "ready": pod_ready}]},
        } for _ in range(pod_count)]},
        "pvc": {"metadata": {"uid": "stable-pvc-uid"}, "status": {"phase": "Bound"}},
        "endpointslices": {"items": [{
            "metadata": {"labels": {"kubernetes.io/service-name": "t3-owner"}},
            "ports": [{"name": "http", "port": 3773, "protocol": "TCP"}],
            "endpoints": [{
                "conditions": {"ready": True},
                "targetRef": {"kind": "Pod", "name": "t3-owner-test",
                              "namespace": "t3-k3s-p0", "uid": pod_uid},
                "addresses": ["10.42.0.9"],
            }],
        }]},

        "networkpolicies": {"items": [{
            "metadata": {"name": "t3-p0-ingress"},
            "spec": {
                "podSelector": {"matchLabels": {"app": "t3-owner"}},
                "policyTypes": ["Ingress"],
                "ingress": [{
                    "from": [{"namespaceSelector": {
                        "matchLabels": {"kubernetes.io/metadata.name": "tailscale"}}}],
                    "ports": [{"protocol": "TCP", "port": 3773}],
                }],
            },
        }]},
        "service": {"spec": {"type": "ClusterIP", "selector": {"app": "t3-owner"},
                             "ports": [{"name": "http", "port": 80, "targetPort": "http"}]}},
        "ingress": {"metadata": {"annotations": {"tailscale.com/funnel": "true"} if funnel else {}},
                    "spec": {"ingressClassName": "tailscale",
                             "tls": [{"hosts": ["t3-k3s-p0"]}],
                             "defaultBackend": {"service": {
                                 "name": "t3-owner", "port": {"name": "http"}}}},
                    "status": {"loadBalancer": {"ingress": [{"hostname": host}]}}},
    }
    # GET and namespace LIST must agree on the same, unique routes.
    for kind in ("service", "ingress"):
        docs[kind]["kind"] = kind.capitalize()
        docs[kind].setdefault("metadata", {}).update({
            "name": "t3-owner", "namespace": "t3-k3s-p0",
            "uid": kind + "-uid",
        })
    docs["services"] = {"kind": "ServiceList", "items": [
        json.loads(json.dumps(docs["service"]))]}
    docs["ingresses"] = {"kind": "IngressList", "items": [
        json.loads(json.dumps(docs["ingress"]))]}
    calls = []
    def read(context, *args):
        calls.append((context, args))
        assert context == "disposable-test"
        assert "apply" not in args and "delete" not in args and "rollout" not in args
        if "exec" in args:
            assert args[3] == "pod/t3-owner-test"
            return identity + "\n"
        if args[3] == "pods":
            assert args[4:] == ("-l", "app=t3-owner", "-o", "json")
        if args[3] == "endpointslices":
            assert args[4:] == ("-l", "kubernetes.io/service-name=t3-owner",
                                "-o", "json")
        if args[3] == "networkpolicies":
            assert args[4:] == ("-o", "json")
        return json.dumps(docs[args[3]])
    return read, calls


class P0EvidenceTest(unittest.TestCase):
    def test_same_id_survives_restart_without_leaking_raw_id(self):
        reader, calls = fake_reads(pod_uid="pod-before")
        before = module.collect("disposable-test", reader)
        after = module.collect("disposable-test", fake_reads(pod_uid="pod-after")[0])
        self.assertNotIn("stable-id", json.dumps(before))
        self.assertNotEqual(before["podUid"], after["podUid"])
        self.assertEqual(
            {k: v for k, v in before.items() if k != "podUid"},
            {k: v for k, v in after.items() if k != "podUid"})
        self.assertEqual(len(calls), 10)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, before)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            module.check_baseline(path, after)
            with self.assertRaises(FileExistsError):
                module.write_baseline(path, before)

    def test_change_in_environment_id_rejected(self):
        first = module.collect("disposable-test", fake_reads("first", pod_uid="before")[0])
        second = module.collect("disposable-test", fake_reads("second", pod_uid="after")[0])
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
                    module.check_baseline(path, {**original, **change, "podUid": "after"})

    def test_not_ready_and_funnel_rejected(self):
        for kwargs in ({"ready": False}, {"funnel": True}, {"host": "example.org"},
                       {"pod_count": 0}, {"pod_count": 2}, {"pod_ready": False},
                       {"pod_uid": ""}, {"deleting": True}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(module.EvidenceError):
                    module.collect("disposable-test", fake_reads(**kwargs)[0])

    def test_unchanged_pod_uid_cannot_claim_restart(self):
        original = module.collect("disposable-test", fake_reads()[0])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, original)
            with self.assertRaisesRegex(module.EvidenceError, "rollout restart not observed"):
                module.check_baseline(path, original)

    def test_changed_image_rejected_even_with_new_pod(self):
        original = module.collect("disposable-test", fake_reads(pod_uid="before")[0])
        changed = module.collect("disposable-test", fake_reads(
            pod_uid="after", image="ghcr.io/me/t3@sha256:" + "b" * 64)[0])
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.json"
            module.write_baseline(path, original)
            with self.assertRaisesRegex(module.EvidenceError, "deploymentImage"):
                module.check_baseline(path, changed)

    def test_no_implicit_kubectl_context(self):
        with self.assertRaises(module.EvidenceError):
            module.kubectl("-unsafe", "get", "pods")

    def test_rejects_hidden_routes_and_controller_exposure(self):
        # A safe named Ingress alone is insufficient: a second Service,
        # a second Ingress, or a ClusterIP annotation can expose the owner.
        edits = [
            ("services", lambda d: d["items"].append(
                {"kind": "Service", "metadata": {"name": "public"},
                 "spec": {"type": "LoadBalancer"}})),
            ("ingresses", lambda d: d["items"].append(
                {"kind": "Ingress", "metadata": {"name": "public"}})),
            ("services", lambda d: d["items"].clear()),
            ("ingresses", lambda d: d["items"][0]["metadata"].update(uid="new-uid")),
            ("ingresses", lambda d: d["items"][0].update(metadata=None)),
            ("service", lambda d: d["metadata"].update(
                annotations={"tailscale.com/expose": "true"})),
            ("ingress", lambda d: d["metadata"].update(
                annotations={"tailscale.com/funnel": "TRUE"})),
            ("service", lambda d: d.update(
                status={"loadBalancer": {"ingress": [{"ip": "203.0.113.4"}]}})),
            ("service", lambda d: d["spec"].update(
                externalName="public.example.invalid")),
            ("service", lambda d: d["spec"].update(
                publishNotReadyAddresses=True)),
        ]
        for index, (kind, edit) in enumerate(edits):
            with self.subTest(case=index, kind=kind):
                normal, _ = fake_reads()

                def altered(context, *args):
                    value = normal(context, *args)
                    if args[3] != kind:
                        return value
                    payload = json.loads(value)
                    edit(payload)
                    return json.dumps(payload)

                with self.assertRaises(module.EvidenceError):
                    module.collect("disposable-test", altered)

    def test_rejects_service_and_ingress_misdirection(self):
        edits = [
            ("service", lambda doc: doc["spec"].update(selector={"app": "other"})),
            ("service", lambda doc: doc["spec"]["ports"][0].update(targetPort="other")),
            ("service", lambda doc: doc["spec"].update(externalIPs=["192.0.2.10"])),
            ("ingress", lambda doc: doc["spec"]["defaultBackend"]["service"].update(name="other")),
            ("ingress", lambda doc: doc["spec"].update(rules=[{"host": "public.example"}])),
            ("ingress", lambda doc: doc["spec"]["tls"][0].update(hosts=["other"])),
        ]
        for kind, edit in edits:
            with self.subTest(kind=kind, edit=edits.index((kind, edit))):
                base, _ = fake_reads()
                def altered(context, *args):
                    value = base(context, *args)
                    if args[3] != kind:
                        return value
                    doc = json.loads(value)
                    edit(doc)
                    return json.dumps(doc)
                with self.assertRaisesRegex(module.EvidenceError, "Service|Ingress"):
                    module.collect("disposable-test", altered)

    def test_rejects_wrong_pod_image_pvc_or_token_mount(self):
        edits = [
            lambda doc: doc["items"][0]["spec"]["containers"][0].update(
                image="ghcr.io/other/t3@sha256:" + "b" * 64),
            lambda doc: doc["items"][0]["spec"]["volumes"][0]["persistentVolumeClaim"].update(
                claimName="another-pvc"),
            lambda doc: doc["items"][0]["spec"].update(automountServiceAccountToken=True),
            lambda doc: doc["items"][0]["spec"]["volumes"].append(
                {"name": "escape", "hostPath": {"path": "/host"}}),
            lambda doc: doc["items"][0]["metadata"].update(labels={"app": "other"}),
        ]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                base, _ = fake_reads()
                def altered(context, *args):
                    value = base(context, *args)
                    if args[3] != "pods":
                        return value
                    doc = json.loads(value)
                    edit(doc)
                    return json.dumps(doc)
                with self.assertRaises(module.EvidenceError):
                    module.collect("disposable-test", altered)


    def test_rejects_stale_service_endpoints(self):
        edits = [
            lambda d: d.update(items=[]),
            lambda d: d["items"][0]["metadata"]["labels"].update(
                {"kubernetes.io/service-name": "unrelated"}),
            lambda d: d["items"][0]["ports"][0].update(port=3774),
            lambda d: d["items"][0]["endpoints"][0]["targetRef"].update(uid="old-uid"),
            lambda d: d["items"][0]["endpoints"][0]["conditions"].update(ready=False),
            lambda d: d["items"][0]["endpoints"][0]["conditions"].update(terminating=True),
            lambda d: d["items"][0]["endpoints"][0].update(addresses=["10.42.0.99"]),
            lambda d: d["items"][0]["endpoints"].append(
                dict(d["items"][0]["endpoints"][0])),
        ]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                base, _ = fake_reads()
                def altered(context, *args):
                    value = base(context, *args)
                    if args[3] != "endpointslices":
                        return value
                    document = json.loads(value)
                    edit(document)
                    return json.dumps(document)
                with self.assertRaisesRegex(module.EvidenceError, "EndpointSlice"):
                    module.collect("disposable-test", altered)

    def test_rejects_unobserved_or_unavailable_rollout(self):
        edits = [
            lambda d: d["status"].update(observedGeneration=6),
            lambda d: d["status"].update(availableReplicas=0),
            lambda d: d["status"].update(updatedReplicas=0),
            lambda d: d["metadata"].update(generation=8),
        ]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                base, _ = fake_reads()
                def altered(context, *args):
                    value = base(context, *args)
                    if args[3] != "deployment":
                        return value
                    document = json.loads(value)
                    edit(document)
                    return json.dumps(document)
                with self.assertRaisesRegex(module.EvidenceError, "rollout"):
                    module.collect("disposable-test", altered)


    def test_rejects_mismatched_or_multiple_tailnet_ingress_routes(self):
        edits = [
            lambda d: d["status"]["loadBalancer"].update(ingress=[]),
            lambda d: d["status"]["loadBalancer"]["ingress"][0].update(
                hostname="unrelated.tailxxx.ts.net"),
            lambda d: d["status"]["loadBalancer"]["ingress"][0].update(
                hostname="t3-k3s-p0.tailxxx.ts.net.evil.example"),
            lambda d: d["status"]["loadBalancer"]["ingress"][0].update(
                hostname="t3-k3s-p0..ts.net"),
            lambda d: d["status"]["loadBalancer"]["ingress"][0].update(
                ip="203.0.113.19"),
            lambda d: d["status"]["loadBalancer"]["ingress"].append(
                {"hostname": "other.tailxxx.ts.net"}),
        ]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                reader, _ = fake_reads()
                def altered(context, *args):
                    raw = reader(context, *args)
                    if args[3] != "ingress":
                        return raw
                    document = json.loads(raw)
                    edit(document)
                    return json.dumps(document)
                with self.assertRaisesRegex(module.EvidenceError, "Ingress"):
                    module.collect("disposable-test", altered)

    def test_rejects_missing_extra_or_widened_network_policy(self):
        edits = [
            lambda d: d.update(items=[]),
            lambda d: d["items"].append(dict(d["items"][0])),
            lambda d: d["items"][0]["metadata"].update(name="unexpected"),
            lambda d: d["items"][0]["spec"]["ingress"][0].update(**{"from": [{}]}),
            lambda d: d["items"][0]["spec"]["ingress"][0]["ports"][0].update(port=3774),
            lambda d: d["items"][0]["spec"].update(policyTypes=["Ingress", "Egress"]),
        ]
        for index, edit in enumerate(edits):
            with self.subTest(index=index):
                reader, _ = fake_reads()
                def altered(context, *args):
                    raw = reader(context, *args)
                    if args[3] != "networkpolicies":
                        return raw
                    document = json.loads(raw)
                    edit(document)
                    return json.dumps(document)
                with self.assertRaisesRegex(module.EvidenceError, "NetworkPolicy"):
                    module.collect("disposable-test", altered)

if __name__ == "__main__":
    unittest.main()
