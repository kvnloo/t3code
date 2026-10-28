# P0 proof only: one persistent server, no worker provisioning.
# The released, self-contained CLI is verified against upstream SHA256SUMS.
# The Debian base tag is not digest-pinned; record/pin the built image digest before deployment.
FROM debian:bookworm-slim

ARG TARGETARCH
ARG T3_VERSION=0.1.3
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl dumb-init git openssh-client tar \
  && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) t3_arch=x64 ;; \
    arm64) t3_arch=arm64 ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  archive="t3-${T3_VERSION}-linux-${t3_arch}.tar.gz"; \
  base="https://github.com/pingdotgg/t3code/releases/download/v${T3_VERSION}"; \
  curl --fail --silent --show-error --location "${base}/SHA256SUMS" -o /tmp/SHA256SUMS; \
  curl --fail --silent --show-error --location "${base}/${archive}" -o /tmp/t3.tar.gz; \
  expected="$(awk -v name="${archive}" '{ n=$2; sub(/^\\*/, "", n); if (n == name) { print $1; exit } }' /tmp/SHA256SUMS)"; \
  test -n "${expected}"; \
  printf '%s  %s\n' "${expected}" /tmp/t3.tar.gz | sha256sum --check --status; \
  mkdir -p /opt/t3; \
  tar -xzf /tmp/t3.tar.gz --strip-components=1 -C /opt/t3; \
  /opt/t3/t3 --version; \
  rm -f /tmp/SHA256SUMS /tmp/t3.tar.gz

RUN groupadd --gid 10001 t3 \
  && useradd --uid 10001 --gid 10001 --home-dir /data --no-create-home --shell /bin/sh t3 \
  && mkdir -p /data \
  && chown 10001:10001 /data

ENV HOME=/data \
    T3CODE_HOME=/data/t3 \
    XDG_CACHE_HOME=/data/.cache \
    XDG_CONFIG_HOME=/data/.config
USER 10001:10001
WORKDIR /data
EXPOSE 3773

# 'serve' prints headless pairing details; 'start --no-browser' does not need
# to print one-time pairing URLs into long-lived Kubernetes pod logs.
# Pair explicitly and transiently via `t3 auth pairing create`.
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/opt/t3/t3"]
CMD ["start", "--no-browser", "--host", "0.0.0.0", "--port", "3773", "--base-dir", "/data/t3"]
