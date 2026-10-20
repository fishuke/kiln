FROM ubuntu/squid:6.6-24.04_beta
COPY squid.conf.template /etc/squid/squid.conf.template
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
