---
title: Approving specs and previews
description: Review a factory's spec and preview, approve or reject them from Slack, the issue, the inbox or MCP, and know what happens next.
owner: docs
section: Product owners
---

Kiln pauses twice for a product owner: once to approve the spec before code is written, and once to accept the running preview before the work goes to review and merge.

## Approving a spec

The spec gate opens when the spec agent has written the spec. You get a request in the source thread or issue, and in your inbox, that shows:

- the acceptance criteria, numbered `AC1`, `AC2`, …,
- open questions, if any,
- criteria that are "Not yet testable", if any,
- a link to the spec pull request. The spec is a Markdown file, by default `docs/specs/<work item id>.md`, on a draft pull request.

Read the criteria as a checklist the finished work must pass. See [Writing acceptance criteria](acceptance-criteria.md).

| You | Result |
| --- | --- |
| Approve | The work item moves to `building`. |
| Reject with feedback | The spec agent rewrites the spec with your feedback, and you get a new request. |

## Accepting a preview

The preview gate opens when the change is deployed to its preview URL. The request shows the preview card: the preview link, the pull request, test counts, and each acceptance criterion with its result and a video.

Open the preview and try the change yourself. The videos show what the tests did.

| You | Result |
| --- | --- |
| Approve | The work moves on to review and hand-off. |
| Reject with feedback | The work goes back to build with your feedback. When it is ready again, Kiln deploys a new preview and asks you again. |

## Where to decide

All surfaces record the same decision, with who decided and through which surface.

| Surface | How |
| --- | --- |
| Slack thread, or a comment on the Linear, Jira or GitHub issue | Reply starting with `approve`, `approved`, `lgtm`, `ship it` or `accept`. To reject, start with `reject`, `changes:` or `request changes`, followed by your feedback. |
| Inbox | Open the gate and approve or reject. |
| API or Kiln MCP | `decide_gate`, with a token that has `decide:spec` or `decide:preview` for the factory. See the [MCP reference](../developer-tools/mcp.md). |

## Timing

Built-in spec and preview gates remind the approvers in the thread every 24 hours. After 72 hours without a decision, the gate expires and the work item is parked as `blocked`. A factory can change these times in `gates/spec-approval.yaml` and `gates/preview-acceptance.yaml`. See [Pipelines and gates](../configuration/pipelines-and-gates.md#gates).

## Who can approve

By default, the requester and everyone in the `po` role are assigned. Deciding through the inbox, the API or the Kiln MCP also needs a token scope: `decide:spec` for specs, `decide:preview` for previews.

## Related pages

- [Writing acceptance criteria](acceptance-criteria.md)
- [Product owner workspace](workspace.md)
- [Previews](../integrations/previews.md)
- [Inbox](../management/inbox.md)
- [Slack](../integrations/slack.md)
