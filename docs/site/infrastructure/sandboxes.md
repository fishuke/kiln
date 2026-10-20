---
title: Sandboxes
description: Where agent runs execute, on a local directory, a Docker container or a Kubernetes pod under gVisor, with an egress allowlist and pause and resume.
owner: docs
section: Infrastructure
---

Every agent run gets a fresh sandbox built from its runner file, and Kiln destroys the sandbox when the run ends.

## Runner files

```yaml
# runners/linux-node.yaml
description: Node 22 with pnpm
backend: docker
shape: { vcpus: 4, memoryGb: 8 }
setupCommands:
  - corepack enable
  - pnpm install --frozen-lockfile
egress:
  - github.com
  - registry.npmjs.org
```

| Key | Default | Notes |
| --- | --- | --- |
| `image` | Kiln's runner image | The container image. Docker pulls it if it is not cached. Without one, runs use the server's runner image (`KILN_RUNNER_IMAGE`), which has the agent CLIs. An image you name must have the harness CLI (`claude`, `codex` or `opencode`) on its `PATH`. |
| `backend` | `docker` | `docker`, `kubernetes` or `local`. |
| `shape` | none | `vcpus` and `memoryGb`. Sets CPU and memory limits. |
| `setupCommands` | `[]` | Run in order after the repositories are cloned, inside each repository (so `pnpm install` finds its `package.json` and the `packageManager` pin). A failing command fails the run. Kiln's runner image has a corepack that runs pnpm 11 and later. |
| `egress` | `[]` | Extra host names the sandbox may reach, such as package registries and your model gateway. The hosts of the repositories it clones are always allowed. |
| `platform.linux.registryCredentialSecretName` | none | A team `docker_registry` or `aws_ecr` secret for a private image. See [Private images](../management/secrets-mcps-environments.md#private-images). |
| `description` | none | |

An agent picks a runner with `runner: <name>`, usually inherited from `agentDefaults`. An agent without a runner uses the server's runner image on the server's default backend, which is `local` unless the server sets another. A run's image is the runner's own, else its [environment](../management/secrets-mcps-environments.md)'s, else `KILN_RUNNER_IMAGE`, else `node:22-bookworm`.

## Backends

### Local

The workspace is a temporary directory on the Kiln host. It runs setup commands and the command guard, but it cannot enforce egress, CPU or memory limits. Use it for development and tests only.

### Docker

Each run is a container started with `sleep infinity` and `/workspace` as its working directory:

- labels `kiln.sandbox=1`, `kiln.dev/run` and `kiln.dev/factory`,
- `--cpus` and `--memory` from `shape`,
- `--security-opt no-new-privileges` and `--cap-drop ALL`,
- the `kiln-egress` network with `HTTPS_PROXY` and `HTTP_PROXY` set to `http://kiln-egress-proxy:3128` and `KILN_EGRESS_ALLOW` set to the allowed hosts: the runner's `egress` list plus the hosts of the cloned repositories. With no hosts at all, the container gets `--network none`.

### Kubernetes with gVisor

Each run is a pod in the `kiln-sandboxes` namespace, plus a NetworkPolicy for that pod:

- `runtimeClassName: gvisor`, so the pod runs in gVisor's user-space kernel,
- `runAsNonRoot` as user 1000, `RuntimeDefault` seccomp, no privilege escalation, all capabilities dropped,
- no service account token mounted, `restartPolicy: Never`,
- requests and limits from `shape`,
- an `emptyDir` volume at `/workspace`.

The NetworkPolicy blocks all ingress. When there are no allowed hosts at all, it blocks all egress too. Otherwise it allows only DNS (UDP 53 to `kube-dns`) and TCP 3128 to the pod labeled `app.kubernetes.io/name: kiln-egress-proxy`, which enforces the host list.

Kiln waits up to 120 seconds for the pod to be ready. Your cluster needs a `gvisor` RuntimeClass and the egress proxy deployed.

## Egress

Agents need the network to clone, install packages and call model APIs. Kiln keeps that surface small:

- The hosts of the repositories the run clones, such as `github.com`, are always allowed.
- List every other host the run needs in `egress`, such as `registry.npmjs.org`. Nothing else is reachable.
- The proxy enforces host names, so you do not have to track IP addresses.
- Keep model traffic going to your model gateway, and list only the gateway.

## What Kiln does in the sandbox

Kiln runs its own commands as trusted, so the command guard does not check them:

- configure git as `kiln-agent[bot]` and exclude `.kiln/` from git,
- check out the work item's branch, or the pinned commit for replays and benchmarks,
- write skills and harness settings,
- after the run, commit leftovers and push the branch with the run token.

Commands the agent runs through the sandbox's command API pass the [command guard](../configuration/decisions.md#command-guard).

## Pause and resume

A running agent can be paused, for example while it waits at a gate, and resumed later on any node.

- **Pause** packs `/workspace` into a `.tgz` archive, stores it in object storage under `snapshots/<sandbox>/<time>.tgz`, and stops the agent. The run's status becomes `paused` and the sandbox is kept until it resumes.
- **Resume** starts a new sandbox from the same runner, possibly on another node or backend, unpacks the snapshot into `/workspace`, and starts the harness again with the original request and any steering messages so far.
- The run records the workspace hash at pause and at resume, so you can check the workspace is the same.

Snapshots hold files only. On Docker, the server can also be set to take a CRIU checkpoint that keeps processes; the snapshot records whether it did. Kubernetes snapshots never keep processes.

## Related pages

- [Harnesses](harnesses.md)
- [Architecture and security](architecture-and-security.md)
- [Self-hosting](self-hosting.md)
- [Typed decisions](../configuration/decisions.md)
