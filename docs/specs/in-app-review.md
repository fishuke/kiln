# Review pull requests in Kiln

Request (2026-10-20): the inbox showed "Accept the preview" with a made-up preview URL, sent
people to GitHub to review, and asked for a review the risk check should have skipped.

## Causes

1. With no Vercel settings the API used `FakePreview`, which invents
   `https://pr-N.<repo>.preview.test`, so every PR got a preview gate.
2. `review-risk` ran with `files: [], additions: 0, deletions: 0`, and its only outcome
   chose who the merge gate went to. Nothing could skip human review.
3. The inbox had no diff and no way to review.

## Acceptance criteria

- AC1 Without a real preview provider no preview is deployed and no preview gate opens
  (`FakePreview` only with fake agents). The pane shows preview links only when there is one.
- AC2 `review-risk` gets the PR's changed files and line counts from the forge.
- AC3 `skip_review` (low risk, no sensitive area, and the AI reviewer did not say
  `needs_human`): hand-off opens no gate; the task shows under "Ready to merge".
- AC4 Otherwise the merge gate is a "Review" item: the pane shows the diff per file, takes
  line comments and a summary, and submits Approve, Request changes or Comment as the
  person's linked GitHub account. Request changes also sends the comments to the agents.
- AC5 Merge from Kiln merges as the person; the merge webhook completes the task.
- AC6 Without a linked GitHub account the pane says so, offers "Link GitHub", and keeps
  "View on GitHub".
- AC7 Run tokens, the app identity and agent definitions can never reach a person's token.

## Packages

- integrations: `Forge.pullRequestFiles`, `Forge.asPerson(token)` → `submitReview`, `merge`;
  GitHub and fake implementations with contract tests.
- engine: person token store (`person_tokens`), review-risk input, `skip_review`, merge-gate
  rejection loops back to build.
- api: config (preview), store the token on GitHub linking, routes for files, review, merge.
- web: review pane in the inbox, "Ready to merge" list.
