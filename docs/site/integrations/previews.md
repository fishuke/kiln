---
title: Previews
description: Deploy each factory pull request to a preview environment on Vercel or Kubernetes, post a card with videos, ask a person to accept it, and serve Studio's live previews.
owner: docs
section: Code forges and integrations
---

A preview provider deploys each factory pull request to its own URL, so a person can try the change and accept it before review and merge.

## How previews fit in

When a preview provider is configured, the foreman's default path adds a preview stage after verify. In a [pipeline](../configuration/pipelines-and-gates.md), add it yourself:

```yaml
- { id: preview, action: preview.deploy, gate: preview-acceptance }
```

The preview stage:

1. Deploys the work item's branch.
2. Comments a card on the pull request with the preview URL, the pull request link, the test counts and a table of acceptance criteria with their result and a video link.
3. Moves the work item to `awaiting_preview` and opens the stage's gate with the card, the preview URL and each video as evidence.

The stage is skipped when no provider is configured or the work item has no pull request. Without a `gate`, the stage deploys and moves on.

Approving the gate moves the work on. Rejecting it sends the work back to build with your feedback. When it comes back, Kiln deploys again and asks again. See [Approving specs and previews](../product-owners/approving-specs-and-previews.md).

## Providers

Kiln uses one preview provider per installation.

### Vercel

Kiln creates a preview deployment through Vercel's API from the GitHub branch. It needs:

| Setting | Notes |
| --- | --- |
| Token | A Vercel access token. |
| Project | The Vercel project name. |
| Team ID | Optional. For projects owned by a team. |

The preview URL is the deployment's URL.

### Kubernetes

Kiln applies one namespace per pull request with `kubectl apply`:

- a Namespace named `preview-<repo>-pr-<number>` (lowercased, at most 63 characters), labeled `kiln.dev/preview: "true"`,
- a Deployment `app` with one replica of your image,
- a Service `app` on port 80,
- an Ingress for the host `pr-<number>.<repo>.<domain>`.

| Setting | Notes |
| --- | --- |
| Domain | The base domain for preview hosts. Point a wildcard DNS record and certificate at your ingress controller. |
| Image | How to name the image for a repository and branch. Your CI must build and push that image. |
| Port | The container port. Default 3000. |

The preview URL is `https://pr-<number>.<repo>.<domain>`. When the factory is in a project with `preview` variables, Kiln also applies a Secret `app-env` with them and loads it into the container with `envFrom`. See [Project environments](../management/secrets-mcps-environments.md#project-environments). Destroying a preview deletes its namespace.

## Studio live previews

Studio (ADR-012) shows each chat's running dev server, with hot reload, instead of a deployment. The API proxies it from the sandbox.

Each preview gets its own origin, `<id>.<KILN_STUDIO_PREVIEW_DOMAIN>`, never Kiln's. The id is the chat or version id with `_` written as `-`, for example `https://sc-3f9a….preview.kiln.example.com`.

| Variable | Value |
| --- | --- |
| `KILN_STUDIO_PREVIEW_DOMAIN` | The preview domain, for example `preview.kiln.example.com`. Point a wildcard DNS record and a wildcard certificate for `*.<domain>` at the API. For local development, `preview.localhost:4000` gives `http://` URLs, because browsers send `*.localhost` to your own machine. |

When the variable is unset, the preview URL is the sandbox's own address, such as `http://127.0.0.1:4101`. That works only with local sandboxes.

What the proxy does with a request to a preview host:

1. Looks up the id. An unknown, stopped or malformed id gets the same `404 preview not found`.
2. Forwards the method, path, query, body and headers to the dev server in the sandbox, without `Cookie`, `Authorization`, `Proxy-*` and `X-Kiln-*`.
3. Returns the answer without `Set-Cookie`.
4. Tunnels WebSocket upgrades the same way, so Next.js hot reload works.

Preview hosts never reach Kiln's sign-in or API routes, except `GET /api/v1/health`, `GET /api/v1/openapi.json` and `POST /api/v1/guard`, which Kiln answers first on every host.

The id has 128 random bits and is the only credential: anyone with the URL can open the preview. Kiln never lists ids. Because the proxy drops cookies, an app in Studio can't keep a cookie session in its preview; use `localStorage` there.

The API must reach the sandboxes:

- **Docker:** Studio sandboxes also join the internal network `kiln-preview` (`KILN_PREVIEW_NETWORK`), and the API is on it too. No other sandbox and not the egress proxy joins it. The API only connects out to the sandboxes: it closes every connection, and drops every egress-log datagram, from the network's subnet (`KILN_PREVIEW_SUBNET`, default `172.30.250.0/24`). Both compose files set this up.
- **Kubernetes:** set `studio.previewDomain` in the Helm chart. It adds a wildcard Ingress to the API (certificate in the Secret `studio.previewTlsSecret`) and the NetworkPolicy `kiln-preview-ingress`, which lets the API connect to ports 4100–4199 of sandbox pods labeled `kiln.dev/preview: "true"`.

## Evidence on the card

The card's criteria table comes from the verify stage. The verify agent runs Playwright with video on and writes a JSON report to `playwright-report/results.json`. Kiln matches tests to criteria by the `AC<number>` in each test title, such as `AC1: the settings page has a dark mode switch`, and uploads one video per criterion to object storage. See [Writing acceptance criteria](../product-owners/acceptance-criteria.md).

## Related pages

- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Pipelines and gates](../configuration/pipelines-and-gates.md)
- [GitHub](github.md)
- [Self-hosting](../infrastructure/self-hosting.md)
- [Sandboxes](../infrastructure/sandboxes.md)
- [Talking to Studio](../product-owners/talking-to-studio.md)
