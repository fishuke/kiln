---
title: Bitbucket
description: Use Bitbucket Cloud repositories as a factory's forge and start work from pull request comments.
owner: docs
section: Code forges and integrations
---

Bitbucket Cloud works as a forge (branches, pull requests, comments) and can start work from pull request events.

## Set up

1. Create a workspace or repository access token with Repositories: write and Pull requests: write, and set it as `BITBUCKET_TOKEN`. With an app password instead, also set `BITBUCKET_USERNAME`.
2. Add a webhook to `POST /webhooks/bitbucket` with a secret, for Pull request created, Pull request comment created and Repository push. Set the secret as `BITBUCKET_WEBHOOK_SECRET`. Kiln checks the `X-Hub-Signature` header.
3. Set `BITBUCKET_BOT_ACCOUNTS` (comma-separated) to the accounts Kiln posts as, so their own activity is recognized.
4. List the repositories in `factory.yaml` with `forge: bitbucket`. `owner` is the workspace.

## Starting work

| Event | Fires when | Filters |
| --- | --- | --- |
| `pull_request_created` | A pull request is created. | `repos`, `base_branches`, `authors`, `keywords` |
| `pull_request_commented` | Someone comments on a pull request. | `repos`, `authors`, `keywords`, `mentioned` |
| `push` | A branch is pushed. | `repos`, `branches` |

```markdown
---
triggers:
  - provider: bitbucket
    event: pull_request_commented
    filter: { mentioned: [kiln] }
---
```

Bitbucket pull requests have no labels, so label filters and routing labels do not apply.

## Related pages

- [Connections](connections.md)
- [Automations](../configuration/automations.md)
- [Automation triggers](../configuration/automation-triggers.md)
