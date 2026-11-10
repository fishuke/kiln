# ADR-018: Each Docker sandbox has its own egress rule

Status: Proposed · Date: 2026-11-10

## Context

The docs promise that a sandbox reaches only the hosts of its repositories and its runner's `egress` list. The proxy never knew that list. It allowed one static list for every sandbox (`KILN_EGRESS_ALLOW` plus Kiln's own host), and Kiln passed the run's list to the sandbox as an environment variable that nothing read. A host in a runner's `egress` list was denied unless an operator also added it to the server list, and then every sandbox could reach it. An agent's `deniedHosts` were not enforced either.

## Decision

On Docker, the proxy decides per sandbox, by the sandbox's address on the egress network.

- When a sandbox starts, before anything runs in it, Kiln gives the proxy that sandbox's rule: the hosts it may reach (runner `egress`, the team allowlist, the agent's `allowedHosts`, the hosts of its MCP servers, Kiln's own host and the hosts of the repositories it clones) and the hosts it may never reach (`deniedHosts`). Kiln removes the rule with the sandbox.
- The proxy asks a helper on every request, with no caching, because Docker reuses addresses. A rule is stored by address, so a new sandbox on a reused address replaces what was there.
- A sandbox cannot take another sandbox's address: it runs with all capabilities dropped (no `NET_RAW`, no `NET_ADMIN`) and cannot reach the proxy's files.
- Kiln finds the proxy by the image label `kiln.egress-proxy=1` on the egress network and sets rules with `docker exec`. A sandbox that needs the network does not start when the proxy is missing; the error names the command to start it.
- The server list (`KILN_EGRESS_ALLOW`) stays what every sandbox may reach. Order: a sandbox's denied hosts, then the server list, then the sandbox's own list, then deny.
- An entry is a literal host name or address. A leading dot (`.example.com`) also covers subdomains.

Sandboxes also get the API's sandbox-facing URL (`KILN_SANDBOX_URL`). `KILN_PUBLIC_URL` stays the URL for webhooks and links. With Docker and a localhost public URL the default is `http://host.docker.internal:<port>`, since localhost inside a container is not the API.

## Consequences

- A runner's `egress` list works without touching the server list, and one run does not widen another's.
- Kubernetes is unchanged: the NetworkPolicy allows only DNS and the proxy, and the proxy there enforces the server list only. Hosts a run lists must also be in `sandboxes.egressAllow` until the Kubernetes provider sets per-pod rules the same way.
- A run started by a `kiln worker` on Docker gets its rule the same way, from the proxy on the worker's host.
- Rules live in the proxy container. Replacing the proxy container while sandboxes run drops their rules: those sandboxes keep the server list only. Restarting it keeps them.
- If the API stops without removing a sandbox, its rule stays until the address is reused, when the new sandbox's rule replaces it.
