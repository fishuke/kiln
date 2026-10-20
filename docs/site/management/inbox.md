---
title: Inbox
description: Every decision waiting on people, across all factories, ordered by urgency, with the evidence to decide and the same result from every surface.
owner: docs
section: Management
---

The inbox lists every open gate assigned to you across all factories, most urgent first, so you can approve, reject or answer in one place.

## What appears in the inbox

Each item is an open gate:

| Kind | Example title | You can |
| --- | --- | --- |
| Spec | Approve the spec for "Team invites" | Approve or reject with feedback |
| Preview | Accept the preview of "Team invites" | Approve or reject with feedback |
| Question | verify keeps failing on "Fix the nav" | Answer, approve to resume, or reject to cancel |
| Command approval | Allow implement to run a risky command? | Approve to run it, reject to block it |
| Merge | Merge "Team invites" | Approve to confirm completion without a merge |
| Custom | Legal sign-off | Approve or reject |

Each item shows its work item (title, state, factory, pull request, preview URL and spec), the question or details, and evidence links such as the spec pull request, the preview and the videos.

You see gates assigned to you, plus gates with no assignee. Assignees come from the gate's `approvers`; see [Pipelines and gates](../configuration/pipelines-and-gates.md#gates).

## Order

The `inbox-urgency` decision gives each gate an urgency score when it opens. The inbox sorts by urgency, highest first, then by age, oldest first. If the decision is not available, questions get 0.7 and other gates 0.5.

## Deciding

The inbox, Slack and issue replies, the API and the Kiln MCP all call the same decision code. Each decision records:

- the decision (`approve`, `reject` or `answer`),
- your answer or feedback,
- who decided and through which surface (`web`, `slack`, `linear`, `jira`, `github`, `mcp`),
- when.

The decision is added to the work item's conversation and counted as a human touch, and the audit log gets an entry. Deciding a gate that is already closed changes nothing.

A reply in Slack or on an issue or pull request decides a gate only when its author is one of the gate's assignees, or the gate has none. See [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

Only question gates take free-text answers. To decide through the inbox, the API or the MCP, your token needs the matching scope for the factory:

| Gate kind | Scope |
| --- | --- |
| Spec | `decide:spec` |
| Preview | `decide:preview` |
| Question | `decide:question` |
| Merge and custom | `decide:merge` |

## Reminders and expiry

Gates with a `nudge` time post a reminder in the source thread at that interval, naming who the gate waits on. Gates with an `expire` time park, approve or reject on their own when it passes. The built-in spec and preview gates nudge every 24 hours and park after 72 hours. The merge gate nudges every 48 hours.

A command approval waits up to 30 minutes, then expires and the command is blocked.

## From the command line and MCP

`kiln inbox` lists your open gates. The Kiln MCP has `list_inbox` and `decide_gate`. See the [CLI reference](../developer-tools/cli.md) and the [MCP reference](../developer-tools/mcp.md).

## Weekly digest

The digest groups open gates by person, oldest first, with each one's age in hours and a link to it in the inbox.

## Related pages

- [Approving specs and previews](../product-owners/approving-specs-and-previews.md)
- [Pipelines and gates](../configuration/pipelines-and-gates.md)
- [Typed decisions](../configuration/decisions.md)
- [Admin, RBAC and audit](admin-rbac-audit.md)
