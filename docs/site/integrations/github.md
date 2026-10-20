---
title: GitHub
description: Start work from GitHub issues and comments, get pull requests with evidence back, and complete work items on merge.
owner: docs
section: Code forges and integrations
---

GitHub is both a source of work and the place where Kiln delivers it: issues and comments start work items, Kiln opens pull requests on `kiln/*` branches, and a person's merge completes the work.

## Set up

1. Give Kiln a GitHub token, for example from a GitHub App, that can read the factory's repositories, push branches, open and update pull requests, comment, add labels and read check runs. See [Self-hosting](../infrastructure/self-hosting.md#forge-identity).
2. Add a webhook to each repository (or the organization) pointing at `POST /webhooks/github`, with content type `application/json` and a secret. Store the secret in Kiln as `GITHUB_WEBHOOK_SECRET`.
3. Send these events: Issues, Issue comments, Pull requests, Pull request reviews, Check suites and Pushes.
4. List the repositories in `factory.yaml` under `repositories`.
5. Protect `main`: require reviews and status checks, and do not let Kiln's identity bypass them.

Kiln verifies `X-Hub-Signature-256` on every call and ignores repeated `X-GitHub-Delivery` IDs.

## Starting work

Add an automation for the events you want. A common one:

```markdown
---
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repo: [acme/web]
      labels: [kiln-ready]
---
Take the labeled issue through the factory.
```

| Event | Fires when |
| --- | --- |
| `issue_opened` | An issue is opened. `mentioned` holds the `@handles` in its body. |
| `issue_labeled` | A label is added. `label` is the new label; `labels` is all labels. |
| `issue_assigned` | Someone is assigned. |
| `issue_mentioned` | A comment is added to an issue. |
| `pull_request_mentioned` | A comment is added to a pull request. |
| `pull_request_opened`, `pull_request_labeled` | A pull request is opened or labeled. |
| `pull_request_review_submitted` | A review is submitted. |
| `pull_request_merged`, `pull_request_closed` | A pull request is merged, or closed without merging. |
| `check_suite_completed` | A check suite finishes. |
| `push` | A branch is pushed. `head` is the branch name. |

A comment that mentions the factory's alias, such as `@webapp please take this`, starts foreman work in a factory with no automations. See [Automations](../configuration/automations.md).

## What Kiln does on GitHub

- **Branches.** Each work item gets one branch, `kiln/<id>-<title-slug>`. Kiln pushes it with the run's token, which can push only `kiln/*` branches.
- **Spec pull request.** When the work needs a spec, Kiln opens a draft pull request with the spec and the acceptance criteria as a checklist.
- **Pull request body.** It links the work item, the source and the tracker issue, lists the acceptance criteria, and ends with "Opened by the Kiln factory `<alias>`. A person reviews and merges."
- **CI.** The verify stage waits for check runs on the branch. Failures, cancellations and timeouts loop the work back to build.
- **Preview card.** With a preview provider, Kiln comments a card with the preview URL, test counts and one video link per acceptance criterion.
- **Review findings.** Findings that need a person's judgment are posted as a comment.
- **Ready for review.** When the build stage succeeds, Kiln opens the pull request, or takes the spec pull request out of draft.
- **Hand-off.** Kiln adds the label `factory:<alias>` and posts "Ready to merge" with the pull request link where the work started, for example on the source issue.

## After hand-off

- **Merge.** When a person merges the pull request, the `pull_request` webhook completes the work item and closes its open gates.
- **Review comments.** A submitted review that is not an approval sends the work item back to build, with the review text as findings.
- **Comments.** Comments on the source issue or the pull request decide an open spec or preview gate, answer an open question, steer a running agent, or are added to the work item's conversation. Map GitHub logins to people with the server's `identities` option (`github:<login>`). Replies decide a gate only when their author is one of its assignees; see [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

## Config repos

A factory's definition can live in a GitHub repository. Merges to its branch apply the new definition when Kiln receives the `push` webhook, so install the webhook on the config repo too. See [Definitions as code](../configuration/definitions-as-code.md#config-repos-on-github).

## Related pages

- [Automations](../configuration/automations.md)
- [How Kiln works](../overview/how-kiln-works.md)
- [Previews](previews.md)
- [Definitions as code](../configuration/definitions-as-code.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
