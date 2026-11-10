FROM ubuntu/squid:6.6-24.04_beta
# The API finds the proxy by this label to set each sandbox's own rule (ADR-018).
LABEL kiln.egress-proxy=1
COPY squid.conf.template /etc/squid/squid.conf.template
COPY entrypoint.sh /entrypoint.sh
COPY run-acl.sh /usr/local/bin/kiln-run-acl
COPY egress-rule.sh /usr/local/bin/kiln-egress-rule
RUN chmod +x /usr/local/bin/kiln-run-acl /usr/local/bin/kiln-egress-rule && mkdir -p /etc/squid/runs
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
