FROM ghcr.io/zaproxy/zaproxy:2.17.0@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef

USER root

# The official ZAP image includes Firefox, but not Chrome. Debian's Chromium
# and ChromeDriver packages are published for both amd64 and arm64. They are
# installed from the same repository; start-zap.sh rejects a major mismatch.
RUN mkdir -p /var/lib/apt/lists/partial \
    && apt-get update \
    && apt-get install -q -y --no-install-recommends chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

USER zap
