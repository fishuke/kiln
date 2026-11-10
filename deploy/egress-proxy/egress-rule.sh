#!/bin/sh
# kiln-egress-rule set <address> <allowed hosts, comma-separated> [<denied hosts>] | drop <address>
# The Kiln API calls this (docker exec) when a sandbox starts and when it is removed. Rules are keyed
# by the sandbox's address on the egress network, so a new sandbox on a reused address replaces the old rule.
set -e
dir=/etc/squid/runs
case "$2" in *[!0-9a-fA-F.:]* | "") echo "kiln-egress-rule: bad address" >&2; exit 2 ;; esac
case "$1" in
  set)
    for kind in allow deny; do
      list="$3"; [ "$kind" = deny ] && list="${4:-}"
      printf '%s\n' "$list" | tr ',' '\n' > "$dir/$2.$kind.tmp"
      mv "$dir/$2.$kind.tmp" "$dir/$2.$kind"
    done ;;
  drop) rm -f "$dir/$2.allow" "$dir/$2.deny" ;;
  *) echo "usage: kiln-egress-rule set <address> <allow> [<deny>] | drop <address>" >&2; exit 2 ;;
esac
