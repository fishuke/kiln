#!/bin/sh
set -e
ALLOW=$(echo "${KILN_EGRESS_ALLOW:-github.com,registry.npmjs.org,api.anthropic.com,api.openai.com}" | sed 's/,/ ./g; s/^/./')
sed "s|__ALLOW__|$ALLOW|" /etc/squid/squid.conf.template > /etc/squid/squid.conf
# KILN_EGRESS_LOG (udp://host:port) also sends every request, allowed or denied, to the Kiln API's telemetry;
# with OpenTelemetry on it defaults to the API in the same compose project.
if [ -z "${KILN_EGRESS_LOG:-}" ] && [ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]; then KILN_EGRESS_LOG=udp://api:5140; fi
if [ -n "${KILN_EGRESS_LOG:-}" ]; then echo "access_log $KILN_EGRESS_LOG logformat=squid buffer-size=0KB" >> /etc/squid/squid.conf; fi
exec squid -N -f /etc/squid/squid.conf
