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


def verify_admitted_pod_confinement(pod: dict) -> None:
    """Reject unsafe admission mutations to the actual P0 owner Pod.

    A safe Deployment template or a Ready Pod alone cannot prove the running
    Pod retained the intended process, credential, mount and network limits.
    This remains API evidence, not proof the node/CNI enforces the settings.
    """
    spec = pod.get("spec")
    if not isinstance(spec, dict):
        raise EvidenceError("P0 Pod spec is missing")
    if (spec.get("serviceAccountName") != "t3-p0"
            or spec.get("automountServiceAccountToken") is not False
            or any(spec.get(flag) for flag in ("hostNetwork", "hostPID", "hostIPC",
                                              "shareProcessNamespace"))
            or spec.get("initContainers") or spec.get("ephemeralContainers")
            or spec.get("imagePullSecrets")):
        raise EvidenceError("P0 Pod has unsafe process, network or credential access")
    pod_security = spec.get("securityContext")
    expected_pod_security = {
        "runAsNonRoot": True, "runAsUser": 10001, "runAsGroup": 10001,
        "fsGroup": 10001, "seccompProfile": {"type": "RuntimeDefault"},
    }
    if (not isinstance(pod_security, dict)
            or any(pod_security.get(key) != value
                   for key, value in expected_pod_security.items())
            or pod_security.get("sysctls")):
        raise EvidenceError("P0 Pod security context drifted from restricted template")

    containers = spec.get("containers")
    if not isinstance(containers, list) or len(containers) != 1:
        raise EvidenceError("P0 Pod must have exactly one owner container")
    app = containers[0]
    if not isinstance(app, dict):
        raise EvidenceError("P0 owner container is invalid")
    security = app.get("securityContext")
    if (not isinstance(security, dict)
            or security.get("allowPrivilegeEscalation") is not False
            or security.get("readOnlyRootFilesystem") is not True
            or security.get("privileged") is True
            or security.get("capabilities", {}).get("drop") != ["ALL"]
            or security.get("capabilities", {}).get("add")
            or security.get("seccompProfile", {}).get("type", "RuntimeDefault") != "RuntimeDefault"
            or security.get("procMount", "Default") != "Default"
            or any(app.get(field) for field in ("env", "envFrom", "command", "args"))):
        raise EvidenceError("P0 owner container privilege or command drifted")

    volumes = spec.get("volumes")
    if (not isinstance(volumes, list) or len(volumes) != 2
            or any(not isinstance(volume, dict) for volume in volumes)):
        raise EvidenceError("P0 Pod contains unexpected volumes")
    named = {volume.get("name"): volume for volume in volumes}
    data, tmp = named.get("data", {}), named.get("tmp", {})
    if (set(named) != {"data", "tmp"}
            or set(data) != {"name", "persistentVolumeClaim"}
            or data["persistentVolumeClaim"].get("claimName") != "t3-p0-data"
            or data["persistentVolumeClaim"].get("readOnly") is True
            or set(tmp) != {"name", "emptyDir"}
            or tmp["emptyDir"].get("sizeLimit") != "1Gi"
            or tmp["emptyDir"].get("medium") not in (None, "")):
        raise EvidenceError("P0 Pod volume source drifted")
    mounts = app.get("volumeMounts")
    expected_mounts = {("data", "/data"), ("tmp", "/tmp")}
    if (not isinstance(mounts, list) or len(mounts) != 2
            or any(not isinstance(mount, dict) for mount in mounts)
            or {(mount.get("name"), mount.get("mountPath")) for mount in mounts} != expected_mounts
            or any(set(mount) - {"name", "mountPath", "readOnly"}
                   or mount.get("readOnly") is True for mount in mounts)):
        raise EvidenceError("P0 owner container has unexpected mounts")


def verify_p0_wiring(pod: dict, deployment_image: str, service: dict, ingress: dict) -> None:
    """Fail closed when Ready resources are not wired to this exact T3 owner.

    A listening TCP socket and a populated ingress hostname alone do not prove
    that the ingress reaches the expected pod, image, and persistent volume.
    This does not claim network-policy enforcement, authentication or pairing.
    """
    meta = pod.get("metadata", {})
    spec = pod.get("spec", {})
    containers = spec.get("containers", [])
    if (meta.get("labels", {}).get("app") != "t3-owner"
            or len(containers) != 1 or containers[0].get("name") != "t3"
            or containers[0].get("image") != deployment_image):
        raise EvidenceError("selected Pod does not match pinned T3 Deployment")
    if spec.get("automountServiceAccountToken") is not False:
        raise EvidenceError("selected Pod must not mount a Kubernetes API token")
    volumes = spec.get("volumes", [])
    if any("hostPath" in volume for volume in volumes):
        raise EvidenceError("selected Pod mounts an unexpected hostPath")
    if (not any(mount.get("name") == "data" and mount.get("mountPath") == "/data"
                for mount in containers[0].get("volumeMounts", []))
            or not any(volume.get("name") == "data"
                       and volume.get("persistentVolumeClaim", {}).get("claimName") == "t3-p0-data"
                       for volume in volumes)):
        raise EvidenceError("selected Pod is not backed by the expected persistent T3 PVC")

    verify_admitted_pod_confinement(pod)

    # The Ingress is not the only Kubernetes route to this Service. Even a
    # ClusterIP can gain an independent tailnet proxy via tailscale.com/expose.
    # Require an exact opt-in route contract; reject injected controller hooks.
    for kind, obj in (("Service", service), ("Ingress", ingress)):
        metadata = obj.get("metadata")
        annotations = metadata.get("annotations", {}) if isinstance(metadata, dict) else None
        if (not isinstance(annotations, dict)
                or set(annotations) - {"kubectl.kubernetes.io/last-applied-configuration"}):
            raise EvidenceError(f"P0 {kind} has unapproved exposure annotations")
    status = service.get("status", {})
    if (not isinstance(status, dict)
            or not isinstance(status.get("loadBalancer", {}), dict)
            or status.get("loadBalancer", {}).get("ingress")):
        raise EvidenceError("P0 Service advertises an unexpected external route")

    svc = service.get("spec", {})
    if any(svc.get(field) for field in ("externalName", "loadBalancerIP",
                                       "loadBalancerClass", "externalTrafficPolicy",
                                       "healthCheckNodePort", "publishNotReadyAddresses",
                                       "allocateLoadBalancerNodePorts")):
        raise EvidenceError("P0 Service has unapproved exposure fields")
    ports = svc.get("ports", [])
    if (svc.get("type") != "ClusterIP" or svc.get("externalIPs")
            or svc.get("selector") != {"app": "t3-owner"}
            or len(ports) != 1
            or ports[0].get("name") != "http"
            or ports[0].get("port") != 80
            or ports[0].get("targetPort") != "http"):
        raise EvidenceError("P0 Service does not exclusively route to the T3 owner")
    ing = ingress.get("spec", {})
    backend = ing.get("defaultBackend", {}).get("service", {})
    tls = ing.get("tls", [])
    if (ing.get("rules")
            or backend.get("name") != "t3-owner"
            or backend.get("port", {}).get("name") != "http"
            or len(tls) != 1 or tls[0].get("hosts") != ["t3-k3s-p0"]):
        raise EvidenceError("P0 Ingress is not wired to the private T3 owner Service")


def verify_service_endpoints(pod: dict, endpoint_slices: dict) -> None:
    """Prove Service's live EndpointSlices resolve only to this Ready Pod.

    This verifies API controller wiring, not actual CNI routing, TLS, or ACLs.
    """
    meta = pod.get("metadata", {})
    status = pod.get("status", {})
    pod_name, pod_uid = meta.get("name"), meta.get("uid")
    pod_ips = {status.get("podIP")} if status.get("podIP") else set()
    for address in status.get("podIPs", []):
        if isinstance(address, dict) and address.get("ip"):
            pod_ips.add(address["ip"])
    if not pod_name or not pod_uid or not pod_ips:
        raise EvidenceError("P0 Pod identity/IP is missing from its status")
    slices = endpoint_slices.get("items") if isinstance(endpoint_slices, dict) else None
    if not isinstance(slices, list) or not slices:
        raise EvidenceError("P0 Service has no observed EndpointSlices")
    for item in slices:
        if not isinstance(item, dict) or item.get("metadata", {}).get("labels", {}).get(
                "kubernetes.io/service-name") != "t3-owner":
            raise EvidenceError("P0 EndpointSlice belongs to a different Service")
        ports = item.get("ports", [])
        if (not isinstance(ports, list) or len(ports) != 1
                or not isinstance(ports[0], dict)
                or ports[0].get("name") != "http"
                or ports[0].get("port") != 3773
                or ports[0].get("protocol", "TCP") != "TCP"):
            raise EvidenceError("P0 EndpointSlice does not route to T3 port 3773")
        endpoints = item.get("endpoints", [])
        if not isinstance(endpoints, list) or len(endpoints) != 1:
            raise EvidenceError("P0 EndpointSlice must select exactly one T3 Pod")
        endpoint = endpoints[0]
        ref = endpoint.get("targetRef", {})
        conditions = endpoint.get("conditions", {})
        if (ref.get("kind") != "Pod" or ref.get("name") != pod_name
                or ref.get("uid") != pod_uid
                or ref.get("namespace", "t3-k3s-p0") != "t3-k3s-p0"
                or conditions.get("ready") is not True
                or conditions.get("terminating") is True):
            raise EvidenceError("P0 EndpointSlice selects an unready/stale Pod")
        addresses = endpoint.get("addresses", [])
        if (not isinstance(addresses, list) or not addresses
                or any(not isinstance(ip, str) or ip not in pod_ips for ip in addresses)):
            raise EvidenceError("P0 EndpointSlice routes to a stale/wrong Pod IP")



def verify_private_ingress(ingress: dict) -> str:
    """Reject unexpected public/second routes and mismatched tailnet identity.

    A plausible .ts.net suffix alone is insufficient: the DNS device label
    must match the explicit Tailscale Ingress name in this P0 fixture.
    This verifies API metadata, not TLS or tailnet ACL enforcement.
    """
    addresses = ingress.get("status", {}).get("loadBalancer", {}).get("ingress")
    if not isinstance(addresses, list) or len(addresses) != 1:
        raise EvidenceError("P0 Ingress must advertise exactly one private hostname")
    entry = addresses[0]
    if not isinstance(entry, dict) or entry.get("ip"):
        raise EvidenceError("P0 Ingress must not advertise a public/IP route")
    hostname = entry.get("hostname")
    labels = hostname.split(".") if isinstance(hostname, str) else []
    if (len(labels) != 4 or labels[0] != "t3-k3s-p0"
            or labels[2:] != ["ts", "net"]
            or not labels[1]
            or labels[1].startswith("-") or labels[1].endswith("-")
            or len(labels[1]) > 63
            or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789-" for ch in labels[1])):
        raise EvidenceError("P0 Ingress hostname does not match the requested tailnet name")
    return hostname


def verify_private_network_policy(policies: dict) -> None:
    """Conservatively reject missing or extra additive policies for this P0 namespace.

    NetworkPolicies are additive: verifying one safe policy while another
    allows all traffic would otherwise produce a false-green result.
    CNI enforcement still requires a separately observed negative test.
    """
    items = policies.get("items") if isinstance(policies, dict) else None
    if not isinstance(items, list) or len(items) != 1:
        raise EvidenceError("P0 requires exactly one isolated ingress NetworkPolicy")
    item = items[0]
    if not isinstance(item, dict) or item.get("metadata", {}).get("name") != "t3-p0-ingress":
        raise EvidenceError("unexpected P0 NetworkPolicy identity")
    expected = {
        "podSelector": {"matchLabels": {"app": "t3-owner"}},
        "policyTypes": ["Ingress"],
        "ingress": [{
            "from": [{"namespaceSelector": {
                "matchLabels": {"kubernetes.io/metadata.name": "tailscale"}}}],
            "ports": [{"protocol": "TCP", "port": 3773}],
        }],
    }
    if item.get("spec") != expected:
        raise EvidenceError("P0 NetworkPolicy allows a different ingress scope")

def verify_exclusive_routes(service: dict, ingress: dict,
                            services: dict, ingresses: dict) -> None:
    """Reject a second namespace route to the P0 owner, including public ones.

    API snapshots do not establish actual CNI/tailnet enforcement or prevent
    later mutations; those require separate negative runtime probes.
    """
    for name, listed, expected, list_kind, item_kind in (
        ("Service", services, service, "ServiceList", "Service"),
        ("Ingress", ingresses, ingress, "IngressList", "Ingress"),
    ):
        items = listed.get("items") if isinstance(listed, dict) else None
        if (not isinstance(listed, dict) or listed.get("kind") != list_kind
                or not isinstance(items, list) or len(items) != 1
                or not isinstance(items[0], dict)
                or items[0].get("kind") != item_kind
                or not isinstance(items[0].get("metadata"), dict)
                or items[0]["metadata"].get("name") != "t3-owner"
                or items[0] != expected):
            raise EvidenceError(f"P0 has an extra, missing, or changed {name} route")


def collect(context: str, read=kubectl) -> dict[str, str]:
    def get(kind: str, name: str) -> dict:
        try:
            return json.loads(read(context, "-n", NAMESPACE, "get", kind, name, "-o", "json"))
        except (json.JSONDecodeError, TypeError) as exc:
            raise EvidenceError("invalid kubectl JSON") from exc

    deployment = get("deployment", "t3-owner")
    pod_spec = deployment.get("spec", {}).get("template", {}).get("spec", {})
    generation = deployment.get("metadata", {}).get("generation")
    deployment_status = deployment.get("status", {})
    if (deployment.get("spec", {}).get("replicas") != 1
            or not isinstance(generation, int) or generation < 1
            or deployment_status.get("observedGeneration") != generation
            or deployment_status.get("updatedReplicas") != 1
            or deployment_status.get("availableReplicas") != 1
            or deployment_status.get("readyReplicas") != 1
            or pod_spec.get("automountServiceAccountToken") is not False):
        raise EvidenceError("P0 Deployment rollout not fully observed/Ready or mounts API token")
    containers = pod_spec.get("containers", [])
    if len(containers) != 1 or "@sha256:" not in containers[0].get("image", ""):
        raise EvidenceError("P0 deployment must use exactly one digest-pinned container")

    # A Deployment can report Ready without having been restarted. Select one
    # concrete, Ready Pod so a later comparison proves the rollout occurred.
    try:
        pod_list = json.loads(read(context, "-n", NAMESPACE, "get", "pods",
                                   "-l", "app=t3-owner", "-o", "json"))
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvidenceError("invalid kubectl pod list JSON") from exc
    pods = pod_list.get("items") if isinstance(pod_list, dict) else None
    if not isinstance(pods, list) or len(pods) != 1 or not isinstance(pods[0], dict):
        raise EvidenceError("P0 must have exactly one selected Pod")
    pod = pods[0]
    pod_meta = pod.get("metadata", {})
    pod_status = pod.get("status", {})
    container_statuses = pod_status.get("containerStatuses", [])
    pod_uid = pod_meta.get("uid")
    pod_name = pod_meta.get("name")
    if (not pod_uid or not pod_name or pod_meta.get("deletionTimestamp")
            or pod_status.get("phase") != "Running"
            or len(container_statuses) != 1
            or container_statuses[0].get("name") != "t3"
            or container_statuses[0].get("ready") is not True):
        raise EvidenceError("P0 selected Pod must be Running, Ready, and not deleting")

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
    hostname = verify_private_ingress(ingress)

    verify_p0_wiring(pod, containers[0]["image"], service, ingress)

    # P0 has a dedicated namespace. A second Service or Ingress can expose
    # the very same Pod despite a safe-looking named Tailscale Ingress.
    try:
        all_services = json.loads(read(context, "-n", NAMESPACE, "get",
                                       "services", "-o", "json"))
        all_ingresses = json.loads(read(context, "-n", NAMESPACE, "get",
                                        "ingresses", "-o", "json"))
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvidenceError("invalid kubectl route inventory JSON") from exc
    verify_exclusive_routes(service, ingress, all_services, all_ingresses)

    # A matching Service selector is not proof that kube-proxy is directing
    # traffic to this Pod. Reconcile the live EndpointSlices and Pod UID/IP.
    try:
        endpoint_slices = json.loads(read(context, "-n", NAMESPACE, "get", "endpointslices",
                                         "-l", "kubernetes.io/service-name=t3-owner",
                                         "-o", "json"))
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvidenceError("invalid kubectl EndpointSlice JSON") from exc
    verify_service_endpoints(pod, endpoint_slices)

    # NetworkPolicy isolation is additive: reject a missing/extra/widened
    # policy instead of checking only the expected policy's name.
    try:
        network_policies = json.loads(read(context, "-n", NAMESPACE, "get",
                                          "networkpolicies", "-o", "json"))
    except (json.JSONDecodeError, TypeError) as exc:
        raise EvidenceError("invalid kubectl NetworkPolicy JSON") from exc
    verify_private_network_policy(network_policies)

    # Explicitly read the owner's current identity; never log/print it.
    raw_id = read(context, "-n", NAMESPACE, "exec", f"pod/{pod_name}", "--",
                  "cat", "/data/t3/userdata/environment-id").strip()
    if not raw_id or len(raw_id) > 512 or "\n" in raw_id or "\r" in raw_id:
        raise EvidenceError("missing or malformed persisted T3 environment ID")
    return {
        "format": "t3-k3s-p0-identity-v2",
        "environmentIdHash": hashlib.sha256(raw_id.encode("utf-8")).hexdigest(),
        "podUid": pod_uid,
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
    if not old.get("podUid") or old["podUid"] == record["podUid"]:
        raise EvidenceError("P0 Pod UID unchanged; rollout restart not observed")
    for field in ("environmentIdHash", "pvcUid", "endpointHost", "deploymentImage"):
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
            print("PASS: P0 route/PVC preflight observed; baseline saved with mode 0600")
        else:
            check_baseline(args.check_baseline, record)
            print("PASS: fresh Ready Pod and route observed; persisted ID, PVC, endpoint and image unchanged")
        print("NOT RUN: client pairing, auth, data/thread restoration, provider and policy enforcement")
    except (EvidenceError, OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"FAIL: {exc}\n")


if __name__ == "__main__":
    main()
