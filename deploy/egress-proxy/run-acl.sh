#!/bin/sh
# Squid external ACL helper (ADR-018). Squid writes "<sandbox address> <destination host>" per request;
# the answer is OK when the host is in that sandbox's list /etc/squid/runs/<address>.<allow|deny>.
# An entry matches its own name; an entry with a leading dot also matches every subdomain.
kind="$1"
while read -r src host _; do
  answer=ERR
  host=$(printf '%s' "$host" | tr 'A-Z' 'a-z')
  file="/etc/squid/runs/$src.$kind"
  if [ -f "$file" ]; then
    while read -r entry; do
      case "$entry" in
        "") ;;
        .*) case "$host" in "${entry#.}" | *"$entry") answer=OK ;; esac ;;
        *) [ "$host" = "$entry" ] && answer=OK ;;
      esac
    done < "$file"
  fi
  echo "$answer"
done
