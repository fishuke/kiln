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

| Key                                           | Default             | Notes                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`                                       | Kiln's runner image | The container image. Docker pulls it if it is not cached. Without one, runs use the server's runner image (`KILN_RUNNER_IMAGE`), which has the agent CLIs. An image you name must have the harness CLI (`claude`, `codex` or `opencode`) on its `PATH`. |
| `backend`                                     | `docker`            | `docker`, `kubernetes` or `local`.                                                                                                                                                                                                                      |
| `shape`                                       | none                | `vcpus` and `memoryGb`. Sets CPU and memory limits.                                                                                                                                                                                                     |
| `setupCommands`                               | `[]`                | Run in order after the repositories are cloned, inside each repository (so `pnpm install` finds its `package.json` and the `packageManager` pin). A failing command fails the run. Kiln's runner image has a corepack that runs pnpm 11 and later.      |
| `egress`                                      | `[]`                | Extra host names the sandbox may reach, such as package registries and your model gateway. The hosts of the repositories it clones are always allowed.                                                                                                  |
| `platform.linux.registryCredentialSecretName` | none                | A team `docker_registry` or `aws_ecr` secret for a private image. See [Private images](../management/secrets-mcps-environments.md#private-images).                                                                                                      |
| `description`                                 | none                |                                                                                                                                                                                                                                                         |

An agent picks a runner with `runner: <name>`, usually inherited from `agentDefaults`. An agent without a runner uses the server's runner image on the server's default backend, which is `local` unless the server sets another. A run's image is the runner's own, else its [environment](../management/secrets-mcps-environments.md)'s, else `KILN_RUNNER_IMAGE`, else `node:22-bookworm`.

## Backends

### Local

The workspace is a temporary directory on the Kiln host. It runs setup commands and the command guard, but it cannot enforce egress, CPU or memory limits. Use it for development and tests only.

### Docker

Each run is a container started with `sleep infinity` and `/workspace` as its working directory:

- labels `kiln.sandbox=1`, `kiln.dev/run` and `kiln.dev/factory`,
- `--cpus` and `--memory` from `shape`,
- `--security-opt no-new-privileges` and `--cap-drop ALL`,
- the `kiln-egress` network with `HTTPS_PROXY` and `HTTP_PROXY` set to `http://kiln-egress-proxy:3128` (and `NODE_USE_ENV_PROXY=1`, so Node's `fetch`, which corepack uses to download pnpm, goes through the proxy too) and `KILN_EGRESS_ALLOW` set to the allowed hosts: the runner's `egress` list plus the hosts of the cloned repositories. With no hosts at all, the container gets `--network none`.
- Studio sandboxes only: the `kiln-preview` network (`KILN_PREVIEW_NETWORK`) as well, where the API reaches their dev servers for [live previews](../integrations/previews.md#studio-live-previews). On Kubernetes they get the label `kiln.dev/preview: "true"` instead.

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

## Cleaning up sandboxes

A sandbox is removed when its run ends, and also when cloning or setup fails. Sandboxes a restart cut off (a deploy or a crash during a run) are removed when the server starts, and a sweep every 10 minutes removes any that a failed clean-up left behind.

The sweep only removes sandboxes the server itself made: Docker containers labeled `kiln.sandbox=1` with `kiln.owner=kiln` (or no owner, for containers from older versions), and work directories under the local backend's root. A `kiln worker` labels its containers `kiln.owner=worker:<worker id>`, so the server leaves them alone on a shared host. A paused run resumes from its snapshot in object storage, so removing its container after a restart loses nothing.

On a Docker host, images and build cache from earlier deploys also take space. Prune them from time to time:

```sh
docker system df
docker builder prune -af
docker image prune -af
```

## Pause and resume

A running agent can be paused, for example while it waits at a gate, and resumed later on any node.

- **Pause** packs `/workspace` into a `.tgz` archive, stores it in object storage under `snapshots/<sandbox>/<time>.tgz`, and stops the agent. The run's status becomes `paused` and the sandbox is kept until it resumes.
- **Resume** starts a new sandbox from the same runner, possibly on another node or backend, unpacks the snapshot into `/workspace`, and starts the harness again with the original request and any steering messages so far.
- The run records the workspace hash at pause and at resume, so you can check the workspace is the same.

Snapshots hold files only. On Docker, the server can also be set to take a CRIU checkpoint that keeps processes; the snapshot records whether it did. Kubernetes snapshots never keep processes.

## The Studio runner

Studio Apps run in their own image, `kiln-runner-studio`, so a new App needs no install. It is the runner image plus the Next.js template from `templates/nextjs` at `/opt/kiln/templates/nextjs`, with its `node_modules` installed, the pnpm store at `/opt/kiln/pnpm-store` and pnpm itself cached for corepack.

```sh
docker build -t kiln-runner-node:local runners/images/node
docker build -t kiln-runner-studio:local -f runners/images/studio/Dockerfile templates/nextjs
```

Set `KILN_STUDIO_IMAGE=kiln-runner-studio:local` on the API. Without it, Studio uses `KILN_RUNNER_IMAGE` and creates the App with `create-next-app`, which downloads everything and takes minutes. `runners/studio.yaml` is the matching runner file.

The template is App Router, TypeScript, Tailwind CSS 4 and shadcn/ui, with `AGENTS.md` (and a `CLAUDE.md` that imports it) telling agents to keep the dev server running, use the components in `components/ui/` and keep turns small. Its Studio settings are in `templates/templates.json`:

| Step                       | Command                                                                  | Time              |
| -------------------------- | ------------------------------------------------------------------------ | ----------------- |
| Create the App             | `cp -a /opt/kiln/templates/nextjs/. .`                                   | 1–3 s             |
| Install in a chat worktree | hard-link the App's `node_modules`, then `pnpm install --prefer-offline` | about 1 s         |
| Start the preview          | `pnpm next dev --turbopack --port {port} --hostname 0.0.0.0`             |                   |
| Ready                      | `GET /` on the port answers                                              | 4–5 s after start |

The first preview is up 7 to 10 seconds after the App is created. A worktree hard-links `node_modules` because importing 400 MB from a store in an image layer makes overlayfs copy every file (about 20 seconds). The template loads its Geist fonts from the `geist` package, so the dev server needs no host but `registry.npmjs.org`. When the server sets `KILN_STUDIO_PREVIEW_DOMAIN`, the template's `next.config.ts` allows `*.<domain>` as a dev origin, so hot reload works through the preview proxy.

To measure the boot on your machine:

```sh
pnpm tsx scripts/studio-template.ts kiln-runner-studio:local
KILN_STUDIO_BOOT_IMAGE=kiln-runner-studio:local pnpm vitest run scripts/studio-template.test.ts
```

The test is skipped unless `KILN_STUDIO_BOOT_IMAGE` is set and Docker answers.

## Related pages

- [Harnesses](harnesses.md)
- [Architecture and security](architecture-and-security.md)
- [Self-hosting](self-hosting.md)
- [Typed decisions](../configuration/decisions.md)
