#!/bin/sh
set -e
HOSTS="${KILN_EGRESS_ALLOW:-github.com,registry.npmjs.org,api.anthropic.com,api.openai.com}"
# Kiln itself (KILN_PUBLIC_URL) is always allowed: agents' command guard and the Kiln MCP server live there.
KILN_HOST=$(echo "${KILN_PUBLIC_URL:-}" | sed -E 's|^[a-z]+://||; s|[:/].*$||')
if [ -n "$KILN_HOST" ]; then HOSTS="$HOSTS,$KILN_HOST"; fi
ALLOW=$(echo "$HOSTS" | sed 's/,/ ./g; s/^/./')
sed "s|__ALLOW__|$ALLOW|" /etc/squid/squid.conf.template > /etc/squid/squid.conf
# KILN_EGRESS_LOG (udp://host:port) also sends every request, allowed or denied, to the Kiln API's telemetry;
# with OpenTelemetry on it defaults to the API in the same compose project.
if [ -z "${KILN_EGRESS_LOG:-}" ] && [ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]; then KILN_EGRESS_LOG=udp://api:5140; fi
if [ -n "${KILN_EGRESS_LOG:-}" ]; then echo "access_log $KILN_EGRESS_LOG logformat=squid buffer-size=0KB" >> /etc/squid/squid.conf; fi
exec squid -N -f /etc/squid/squid.conf
