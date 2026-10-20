#!/bin/sh
set -e
ALLOW=$(echo "${KILN_EGRESS_ALLOW:-github.com,registry.npmjs.org,api.anthropic.com,api.openai.com}" | sed 's/,/ ./g; s/^/./')
sed "s|__ALLOW__|$ALLOW|" /etc/squid/squid.conf.template > /etc/squid/squid.conf
exec squid -N -f /etc/squid/squid.conf
