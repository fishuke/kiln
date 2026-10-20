---
title: Previews
description: Deploy each factory pull request to a preview environment on Vercel or Kubernetes, post a card with videos, and ask a person to accept it.
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

The preview URL is `https://pr-<number>.<repo>.<domain>`. Destroying a preview deletes its namespace.

## Evidence on the card

The card's criteria table comes from the verify stage. The verify agent runs Playwright with video on and writes a JSON report to `playwright-report/results.json`. Kiln matches tests to criteria by the `AC<number>` in each test title, such as `AC1: the settings page has a dark mode switch`, and uploads one video per criterion to object storage. See [Writing acceptance criteria](../product-owners/acceptance-criteria.md).

## Related pages

- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Pipelines and gates](../configuration/pipelines-and-gates.md)
- [GitHub](github.md)
- [Self-hosting](../infrastructure/self-hosting.md)
