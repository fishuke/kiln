---
title: GitLab
description: Use GitLab.com or self-managed GitLab as a factory's forge, and start work by mentioning the factory's bot in merge request comments.
owner: docs
section: Code forges and integrations
---

GitLab works as a forge (branches, merge requests, labels, comments) and as a source of work: mention the factory's bot in a merge request comment and the factory replies in that discussion.

## Set up

1. Create a group access token or service account token with the Owner role and the `api` scope on your top-level group. This manager token maintains the group webhook and does the factory's forge work. Set it as `GITLAB_TOKEN`.
2. For self-managed GitLab, set `GITLAB_BASE_URL`, such as `https://gitlab.acme.test`. The default is `https://gitlab.com`.
3. Create a bot service account for each factory, named for example `webapp-kiln-ab12`, with the Developer role on the projects it works on. List the bot usernames in `GITLAB_BOT_USERNAMES` (comma-separated). Mentions of these usernames start work, and their own activity never triggers automations.
4. Add a group webhook to `POST /webhooks/gitlab` with a secret token, for Note (comments), Merge request and Push events. Set the same token as `GITLAB_WEBHOOK_TOKEN`. Kiln refuses calls whose `X-Gitlab-Token` does not match.
5. List the projects in `factory.yaml` with `forge: gitlab`. `owner` is the group path, which may include subgroups:

```yaml
repositories:
  - { forge: gitlab, owner: acme/platform, name: api }
```

You can also connect GitLab from the API with the group path and manager token; see [Connections](connections.md). Per-factory bot tokens are not used yet: forge work uses the one manager token.

## Starting work

| Event | Fires when |
| --- | --- |
| `bot_mentioned` | A new comment on a merge request or issue mentions a factory bot. Edits never fire. |
| `merge_request` | A merge request is opened, updated, closed, reopened, merged or approved. `action` holds which. |
| `push` | A branch is pushed. |

| Event | Filters |
| --- | --- |
| `bot_mentioned` | `repos`. The bot username is managed by Kiln; a definition that sets `mentioned` is rejected. |
| `merge_request` | `actions`, `base_branches`, `repos` |
| `push` | `branches`, `repos` |

```markdown
---
triggers:
  - provider: gitlab
    event: merge_request
    filter: { actions: [open], base_branches: [main] }
---
Review the merge request.
```

The `gitlab-bot-mentions` template starts work from every bot mention. See [Automation triggers](../configuration/automation-triggers.md).

## What Kiln does on GitLab

- **Replies** go to the discussion where the bot was mentioned, or as a note on the merge request.
- **Merge requests** are opened from `kiln/*` branches, as drafts (`Draft: ` prefix) until the work is ready, with the factory's labels.
- **Labels.** Kiln creates the `factory:<alias>` label on the factory's projects.
- **Checks.** CI status comes from the project's pipelines. The `kiln/factory-config` check is reported as a commit status.
- **Merges.** A merged merge request completes its work item. Kiln never merges or approves.

GitLab is not supported as a config repo for factory definitions.

## Related pages

- [Connections](connections.md)
- [Automations](../configuration/automations.md)
- [GitHub](github.md)
- [Self-hosting](../infrastructure/self-hosting.md)
