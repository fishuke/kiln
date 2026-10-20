---
title: Product owner workspace
description: How a product owner works with a Kiln factory, from sending an idea to approving the spec, accepting the preview and planning a roadmap.
owner: docs
section: Product owners
---

As a product owner you send requests, answer the factory's questions, approve specs and accept previews, and you never need to touch code or definitions to do it.

## Your path through a work item

| Step | What you do | Where |
| --- | --- | --- |
| 1. Send an idea | Describe the change in a sentence, with a bulleted list of what must be true. | Slack (`@webapp ...`), a Linear or Jira issue, a labeled GitHub issue, or `kiln send` |
| 2. Answer questions | Reply when the factory asks. | The same thread or issue, or the inbox |
| 3. Approve the spec | Read the acceptance criteria and open questions. Approve, or reject with what to change. | Reply in the thread, or the inbox |
| 4. Accept the preview | Open the preview URL, watch the videos, try the change. Approve, or reject with what to fix. | Reply in the thread, or the inbox |
| 5. Hand over | Engineers review and merge the pull request. You hear "Done" when it merges. | The thread or issue |

Steps 3 and 4 only happen when the work needs a spec and when previews are set up. Small, clear changes go straight to build.

## Where to work

- **The source thread or issue.** Everything about a work item is posted where it started. Reply there to approve, reject or answer. See [Slack](../integrations/slack.md).
- **The inbox.** All decisions waiting on you, most urgent first, across every factory. See [Inbox](../management/inbox.md).
- **The weekly digest.** A list of the decisions still waiting on you, with how long each has waited and a link to it.
- **Planning.** Turn a goal or a PRD into epics and tracker issues for one or more factories. See [Planning](planning.md).

## What your access allows

Ask your admin for a token with the scopes you need, for each factory:

| Scope | Lets you |
| --- | --- |
| `read` | See work items, runs, metrics and gates. |
| `send` | Send work, post messages, create projects and plan roadmaps. |
| `decide:spec` | Approve or reject specs. |
| `decide:preview` | Accept or reject previews. |
| `decide:question` | Answer the factory's questions. |

A product owner's token usually has no `definitions:write`, so it cannot change agents, gates or policies. See [Admin, RBAC and audit](../management/admin-rbac-audit.md).

Whether a gate is assigned to you depends on the gate's `approvers`: by default the requester and everyone in the `po` role.

## What the factory will not do

- It will not merge. An engineer merges through your normal review process.
- It will not start building a large or unclear change before you approve a spec.
- It will not guess when it is stuck. It asks, and parks the work until someone answers.

## Related pages

- [Writing acceptance criteria](acceptance-criteria.md)
- [Approving specs and previews](approving-specs-and-previews.md)
- [Planning](planning.md)
- [Inbox](../management/inbox.md)
