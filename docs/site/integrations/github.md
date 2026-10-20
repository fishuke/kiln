---
title: GitHub
description: Start work from GitHub issues and comments, get pull requests with evidence back, and complete work items on merge.
owner: docs
section: Code forges and integrations
---

GitHub is both a source of work and the place where Kiln delivers it: issues and comments start work items, Kiln opens pull requests on `kiln/*` branches, and a person's merge completes the work.

## Set up

1. Create a GitHub App (Settings → Developer settings → GitHub Apps) with these repository permissions: Contents, Issues, Pull requests and Checks read and write, Metadata read.
2. Set its webhook URL to `POST /webhooks/github` with a secret, and subscribe to Issues, Issue comment, Pull request, Pull request review, Pull request review comment, Check suite, Check run, Status, Workflow run and Push.
3. Give Kiln the app's credentials and install the app on your organization:

| Variable | Notes |
| --- | --- |
| `GITHUB_APP_ID` | The app's ID. |
| `GITHUB_APP_PRIVATE_KEY` | The app's private key, as PEM (`\n` escapes are fine) or base64. |
| `GITHUB_APP_INSTALLATION_ID` | The installation on your organization. Kiln mints a short-lived installation token for each call. |
| `GITHUB_APP_SLUG` | Lets Kiln link to the install page and recognize its own `<slug>[bot]` events. |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The app's OAuth credentials, for people to link their GitHub accounts. |

A plain `GITHUB_TOKEN` still works instead of an app. You can also connect GitHub from the API; see [Connections](connections.md).

4. List the repositories in `factory.yaml` under `repositories`.
5. Protect `main`: require reviews and status checks, and do not let Kiln's identity bypass them.

Kiln verifies `X-Hub-Signature-256` on every call and ignores repeated `X-GitHub-Delivery` IDs.

## Mention the factory

Mention `@kiln-factory` in a new issue, pull request, comment or review. Edits and mentions inside code blocks are ignored.

- **With a `factory:<alias>` label**, the mention goes to that factory.
- **Without a label**, Kiln looks for factories whose `repositories` include the repo. With exactly one, it adds that factory's label and starts the work. With several, it comments asking you to add one of their labels and mention `@kiln-factory` again. With none, it comments that no factory works on the repo yet.

Kiln creates the `factory:<alias>` label on the factory's repositories whenever its definition is applied. Deleting the factory (`DELETE /api/v1/factories/<id>`, Admin role) removes the label again, cancels its open work and deletes its managed webhooks.

The default mentions template routes on both, and you can change the handle or label it filters on:

```markdown
---
triggers:
  - provider: github
    event: issue_mentioned
    filter: { mentioned: [kiln-factory], labels: ["factory:webapp"] }
  - provider: github
    event: issue_assigned
    filter: { assignees: [kiln-factory], labels: ["factory:webapp"] }
---
```

## Starting work

Add an automation for the events you want:

```markdown
---
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: [acme/web]
      labels: [kiln-ready]
---
Take the labeled issue through the factory.
```

GitHub triggers cover issues (`issue_created`, `issue_labeled`, `issue_assigned`, `issue_commented`, `issue_mentioned`), pull requests (`pull_request_opened`, `_ready`, `_reopened`, `_labeled`, `_assigned`, `_synchronized`, `_enqueued`, `_dequeued`, `_review_requested`, `_review_submitted`, `_commented`, `_mentioned`, `_merged`, `_closed`), CI (`check_suite_completed`, `check_suite_rerequested`, `check_run_rerequested`, `commit_status`, `workflow_run_completed`) and `push`. The full list of events and filter keys is in [Automation triggers](../configuration/automation-triggers.md).

- One delivery can produce several events. A comment with a mention is both `issue_commented` and `issue_mentioned`; an automation that listens to both still fires once.
- `skip_bots` defaults to `all`: events from bots never start work. Use `self` to skip only Kiln's own app, or `none`. Admitting Kiln's own events can cause loops.
- On check suite and workflow run events, `number` is the linked pull request.

## What Kiln does on GitHub

- **Branches.** Each work item gets one branch, `kiln/<id>-<title-slug>`. Kiln pushes it with the run's token, which can push only `kiln/*` branches.
- **Spec pull request.** When the work needs a spec, Kiln opens a draft pull request with the spec and the acceptance criteria as a checklist.
- **Pull request body.** It links the work item, the source and the tracker issue, lists the acceptance criteria, and ends with "Opened by the Kiln factory `<alias>`. A person reviews and merges."
- **CI.** The verify stage waits for check runs on the branch. Failures, cancellations and timeouts loop the work back to build.
- **Preview card.** With a preview provider, Kiln comments a card with the preview URL, test counts and one video link per acceptance criterion.
- **Review findings.** Findings that need a person's judgment are posted as a comment.
- **Ready for review.** When the build stage succeeds, Kiln opens the pull request, or takes the spec pull request out of draft.
- **Attribution.** When Kiln opens a pull request, it comments which factory opened it, for whom, from where, and links the work item.
- **Hand-off.** Kiln adds the label `factory:<alias>` and posts "Ready to merge" with the pull request link where the work started, for example on the source issue.

## After hand-off

- **Merge.** When a person merges the pull request, the `pull_request` webhook completes the work item and closes its open gates.
- **Review comments.** A submitted review that is not an approval sends the work item back to build, with the review text as findings.
- **Comments.** Comments on the source issue or the pull request decide an open spec or preview gate, answer an open question, steer a running agent, or are added to the work item's conversation. Map GitHub logins to people with the server's `identities` option (`github:<login>`). Replies decide a gate only when their author is one of its assignees; see [Who may decide from a reply](../configuration/automations.md#who-may-decide-from-a-reply).

## Config repos

A factory's definition can live in a GitHub repository. Merges to its branch apply the new definition when Kiln receives the `push` webhook, so install the app on the config repo too. See [Definitions as code](../configuration/definitions-as-code.md#config-repos-on-github).

### The kiln/factory-config check

On pull requests to a config repo, Kiln reads the head commit, validates it and dry-runs the apply: missing runners and routers, schema errors and alias names that do not resolve all fail the check. The summary counts what would be created, updated and deleted. When nothing in the definition changed, the check passes right away.

- The check is named `kiln/factory-config`, or `kiln/factory-config (<dir>)` when the definition lives in a subdirectory.
- Require it in branch protection to block broken definitions.
- `github.factoryConfigChecks` in `factory.yaml` chooses which pull requests get it: `main` (default) checks only pull requests to the production branch, `all` checks every base branch.

## Related pages

- [Automations](../configuration/automations.md)
- [Automation triggers](../configuration/automation-triggers.md)
- [Connections](connections.md)
- [How Kiln works](../overview/how-kiln-works.md)
- [Previews](previews.md)
- [Definitions as code](../configuration/definitions-as-code.md)
- [Architecture and security](../infrastructure/architecture-and-security.md)
