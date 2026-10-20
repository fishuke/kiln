---
title: Self-hosted workers
description: Run agents on your own machines with kiln worker, route agents to them with workerHost, and monitor them with Prometheus.
owner: docs
section: Infrastructure
---

A self-hosted worker runs agent runs on a machine you choose (a build server, a GPU box, a host inside a private network) while the Kiln server keeps coordinating the work. The worker connects out to the Kiln API; it needs no inbound ports.

## How it works

1. An agent (or automation, or `agentDefaults`) sets `workerHost: <id>`.
2. When that agent runs, the Kiln server prepares the run (prompt, instructions, skills, scoped run token) and queues it for the worker id. The run's state is `QUEUED`.
3. A `kiln worker --worker-id <id>` process long-polls the API, claims the run (`CLAIMED`), creates its sandbox (Docker, Kubernetes or a host directory), clones the repositories with the run token, starts the harness and streams events back (`INPROGRESS`).
4. At the end it reports the result, uploads artifacts from `.kiln/artifacts/` and pushes the `kiln/*` branch with the run token. The server records everything as for any other run.

Several processes can share one worker id; each run goes to the process with the most free capacity. Runs wait in the queue while no worker of that id is connected and fail with `infrastructure_timeout` after 30 minutes. A worker that stops sending heartbeats is dropped and its runs are retried.

## Start a worker

Create a key with the `worker` scope (a worker API key, or `kiln token create --grants worker:*`), then:

```bash
KILN_URL=https://kiln.example.com KILN_WORKER_KEY=kiln_tok_… \
  pnpm kiln worker --worker-id build-farm --backend docker --max-concurrent-tasks 4
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--worker-id` | (required) | The id agents name in `workerHost`. Letters, digits, `.`, `_`, `-`; ids starting with `kiln` are reserved. |
| `--api-key` | `KILN_WORKER_KEY`, else `KILN_TOKEN` | The worker key. |
| `--backend` | `docker` | `docker` (a container per run), `kubernetes` (a pod per run) or `direct` (a directory on the host). |
| `--max-concurrent-tasks` | `0` (unlimited) | Runs at once. |
| `--one-shot` | off | Take one run, then exit (direct backend only). For CI jobs and ephemeral VMs. |
| `--idle-on-complete` | `45m` | How long a one-shot worker stays up after its run. |
| `-v`, `--volumes` | | `HOST:CONTAINER[:ro|rw]` mounts for Docker sandboxes. Repeatable. |
| `-e`, `--env` | | `KEY=VALUE` (or `KEY` to pass the worker's own value) added to every run. Repeatable. |
| `--config-file` | | A YAML or JSON file with the same settings (below). |
| `--no-cleanup` | off | Keep sandboxes after runs, for debugging. |
| `--metrics-port` | | Serve Prometheus metrics on this port at `/metrics`. |
| `--log-level` | `info` | `debug`, `info`, `warn` or `error`. |

### Config file

```yaml
worker_id: build-farm
max_concurrent_tasks: 4
idle_on_complete: 10m
cleanup: true
metrics_port: 9464
backend:
  docker:
    volumes: [/var/cache/npm:/root/.npm]
    image_pull_policy: IfNotPresent   # Always | IfNotPresent | Never
    environment:
      - { name: NPM_TOKEN }             # inherit from the worker's environment
      - { name: CI, value: "true" }
```

The `kubernetes` backend takes `namespace`; the `direct` backend takes `workspace_root`.

## Route agents to a worker

```yaml
# agents/implement/agent.md
---
agentType: IMPLEMENT
workerHost: build-farm
harness:
  type: claude-code
  auth: { source: worker }   # use the credentials already on the worker
---
```

`workerHost` follows the usual inheritance: set it in `agentDefaults` to send every agent, override it per agent or automation, and set it to `""` or `null` to run on the Kiln server again. With `auth: { source: worker }` (or the v1alpha1 spelling `workerEnvironment`) the harness uses the credentials on the worker and Kiln sends none; otherwise Kiln sends the run's harness credential and the agent's secrets with the job.

## Watch workers

- `GET /api/v1/workers` (and `client.workers()`) lists connected processes with their last heartbeat, active runs, and the queue.
- The API's `/metrics` endpoint includes `kiln_workers_connected`, `kiln_worker_runs_active` and `kiln_worker_queue_depth`. Set `KILN_METRICS_TOKEN` to require `Authorization: Bearer <token>`.
- A worker's own `/metrics` (with `--metrics-port`) has `kiln_worker_connected`, `kiln_worker_tasks_active`, `kiln_worker_tasks_max_concurrent`, `kiln_worker_tasks_claimed_total`, `kiln_worker_tasks_completed_total{result}`, `kiln_worker_task_duration_seconds_sum{result}`, `kiln_worker_reconnects_total` and `kiln_worker_info`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Runs stay `QUEUED` | Is a worker with exactly that id connected (`GET /api/v1/workers`)? Ids are case-sensitive. Is it at `--max-concurrent-tasks`? |
| The worker gets 403 | The key needs the `worker` scope or must be a worker key. |
| Runs fail with `environment_setup_failed` | The sandbox could not start or clone: check Docker on the worker, the image, and that the worker can reach the forge. |
| Every shell command is blocked | The worker could not reach `/api/v1/guard`; it blocks commands when the guard is unreachable. |

## Related pages

- [Sandboxes](sandboxes.md)
- [Harnesses](harnesses.md)
- [Agents](../configuration/agents.md)
- [Self-hosting](self-hosting.md)
