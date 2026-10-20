---
title: Azure DevOps
description: Use Azure DevOps repositories and boards with a factory, and start work from pull request and work item mentions and assignments.
owner: docs
section: Code forges and integrations
---

Azure DevOps Services (`dev.azure.com`) works as a forge for Azure Repos and as a source of work from pull requests and Boards work items.

## Set up

1. Create an identity for the factory: a service principal with Basic access, or a user. Give it Contribute on the repositories the factory works on.
2. Create a personal access token for it with Code (read and write), Work items (read and write) and Pull request threads. Set `AZURE_DEVOPS_ORG` to your organization and `AZURE_DEVOPS_TOKEN` to the token.
3. In Project settings → Service hooks, add Web Hooks subscriptions to `POST /webhooks/azure-devops` for: pull request created, updated, merged and commented on; code pushed; work item created, updated and commented on. Use basic authentication with any user name and a password you choose, and set that password as `AZURE_DEVOPS_WEBHOOK_PASSWORD`. To check the user name too, set `AZURE_DEVOPS_WEBHOOK_USER`.
4. Set `AZURE_DEVOPS_IDENTITIES` (comma-separated) to the factory identity's display name, email or ID. Mentions of and assignments to these identities start work.
5. List the repositories in `factory.yaml` with `forge: azure_devops`. `owner` is the project:

```yaml
repositories:
  - { forge: azure_devops, owner: Shop, name: api }
```

You can also connect Azure DevOps from the API with the organization, token and identity; see [Connections](connections.md).

## Starting work

| Event | Fires when | Filters |
| --- | --- | --- |
| `pull_request_created` | A pull request is created. | `base_branches`, `repos`, `source_repos` |
| `pull_request_updated` | A pull request is updated. | the same |
| `pull_request_merged` | A pull request completes. | the same |
| `pull_request_closed` | A pull request is abandoned. | the same |
| `pull_request_commented` | Someone comments on a pull request. | the same |
| `pull_request_mentioned` | A comment mentions the factory identity. | `mentioned`, `repos` |
| `push` | Code is pushed. | `branches`, `repos` |
| `work_item_created` | A work item is created. | `assignees`, `authors`, `labels`, `work_item_types` |
| `work_item_assigned` | A work item is assigned (or created assigned) to someone. | the same |
| `work_item_labeled` | A work item's tags change. | the same |
| `work_item_mentioned` | A work item comment mentions the factory identity. | `mentioned` |

`repos` are `project/repo`. Tags are the work item's `labels`. See [Automation triggers](../configuration/automation-triggers.md).

The default templates cover pull request mentions, work item mentions and work item assignment:

```markdown
---
triggers:
  - provider: azure_devops
    event: work_item_assigned
    filter: { work_item_types: [Bug] }
---
Fix the assigned bug.
```

If mention autocomplete does not offer the factory identity, assign it to a work item once.

## What Kiln does in Azure DevOps

- Opens pull requests from `kiln/*` branches (as drafts until ready) with labels, and comments in new threads.
- Reads commit statuses for CI.
- Creates and reads work items for the forge's issue features.
- A completed pull request completes its work item. Kiln never completes or approves pull requests.

Azure DevOps Server is not supported directly; clone it with runner setup commands instead.

## Related pages

- [Connections](connections.md)
- [Automations](../configuration/automations.md)
- [GitHub](github.md)
