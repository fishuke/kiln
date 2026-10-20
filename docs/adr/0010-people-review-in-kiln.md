# ADR-010: People review and merge in Kiln, as themselves

Status: Proposed · Date: 2026-10-20

## Context

Reviewing a factory pull request meant leaving Kiln for GitHub. Kiln's GitHub App identity is
shared with agent runs (it mints their sandbox tokens), so it must never approve or merge
(ADR-008). A review or merge started from Kiln needs a person's own identity.

## Decision

- When a person links their GitHub account, Kiln keeps that OAuth user token in its own
  collection (`person_tokens`), keyed by Kiln user. It is not a named secret: agent
  definitions cannot ask for it, and it never enters a sandbox, prompt or log.
- The review pane submits reviews (Approve, Request changes, line comments) and merges with
  that token, so GitHub records the person as the reviewer and merger. Without a linked
  account the pane says so and links to GitHub.
- The `review-risk` decision sees the real diff (files, additions, deletions). Its
  `skip_review` outcome means no person needs to read the code: no inbox item opens, and the
  pull request is listed under "Ready to merge", where a person merges with one click.
- Kiln never merges on its own. A low-risk verdict removes the review, not the human merge.

## Consequences

- ADR-008 holds: the app identity and run tokens still cannot approve or merge.
- Revoking the GitHub link deletes the stored token.
- Forges other than GitHub show the diff only when they implement `pullRequestFiles`, and
  review in Kiln only when they implement `asPerson`.
