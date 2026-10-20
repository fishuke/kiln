#!/bin/sh
# Runs the control plane as `node`. With the Docker socket mounted (KILN_SANDBOX=docker), `node`
# joins the socket's group first so it can start sandbox containers.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${KILN_DATA_DIR:-/data}" && chown node:node "${KILN_DATA_DIR:-/data}"
  if [ -S /var/run/docker.sock ]; then
    gid="$(stat -c %g /var/run/docker.sock)"
    getent group "$gid" >/dev/null || groupadd -g "$gid" docker-host
    usermod -aG "$(getent group "$gid" | cut -d: -f1)" node
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
