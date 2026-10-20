/** Default skills seeded into new factories. Each becomes skills/<name>/SKILL.md. */

export type SkillDoc = { name: string; description: string; body: string };

export function githubSkill(alias: string): SkillDoc {
  return {
    name: "github",
    description: "Work with GitHub issues, branches and pull requests the factory way: labels, attribution, descriptions.",
    body: `# GitHub

Use the \`gh\` CLI for reading. Kiln does the writes that need permissions (pushing your branch, opening and updating the pull request, labels), so you never push, open pull requests, approve or merge yourself.

## Reading
- Issue: \`gh issue view <number> --repo <owner/repo> --comments\`
- Search issues: \`gh issue list --repo <owner/repo> --search "<words> in:title,body" --state all --limit 20\`
- Pull request: \`gh pr view <number> --repo <owner/repo> --comments\` and \`gh pr diff <number> --repo <owner/repo>\`
- Checks on a branch: \`gh pr checks <number> --repo <owner/repo>\` or \`gh run list --branch <branch> --repo <owner/repo>\`
- Code owners: \`.github/CODEOWNERS\` or \`CODEOWNERS\`.

## Branches and commits
- Work on the branch Kiln checked out for you (\`kiln/<work-item>-<slug>\`). Do not create others.
- Commit messages: imperative, under 72 characters, with a body when the why is not obvious ("Fix rounding in cart totals", not "fixed stuff").
- Keep generated files and media out of commits unless the repository already tracks them.

## Labels
- Every pull request and every GitHub issue the factory opens or adopts carries \`factory:${alias}\`. Kiln applies it on pull requests; on an adopted issue, mention it in your report if it is missing.
- Never remove labels people set.

## Pull request description
Use the repository template when there is one (\`.github/PULL_REQUEST_TEMPLATE.md\`, \`.github/pull_request_template.md\`, \`docs/pull_request_template.md\`). Otherwise:

\`\`\`markdown
## Summary
What changed and why, in two or three sentences. Link the issue (Fixes #123).

## Changes
- One bullet per meaningful change.

## Verification
- Commands you ran and their result.
- Visual proof for interface changes (Kiln attaches the files in .kiln/artifacts/).
\`\`\`

## Attribution
Each factory pull request carries one comment that says the factory produced it and who asked for it:

> Opened by the Kiln factory \`${alias}\` for @<requester>. A person reviews and merges.

Check for it before asking for one more; one is enough.
`,
  };
}

export const SLACK_SKILL: SkillDoc = {
  name: "slack",
  description: "Write to Slack threads: short messages, mrkdwn formatting, links and mentions.",
  body: `# Slack

Kiln posts what you write back into the thread the request came from. Write for a busy person reading on a phone.

## Shape
- Lead with the outcome or the question. One to three short paragraphs; bullets for lists.
- One message per update. Do not repeat what is already in the thread.
- Ask one clear question at a time; when there are options, number them and say which you recommend.

## Formatting (mrkdwn, not Markdown)
- Bold: \`*bold*\`; italic: \`_italic_\`; code: backticks; code block: triple backticks.
- Links: \`<https://example.com/pr/42|acme/web#42>\`. Link every pull request, issue and spec each time you name it.
- Mentions: \`<@U024BE7LH>\` for a person (use the id from the request), never a display name.
- No headings, tables or images; they do not render.

## Replies
- Plain replies in a factory thread continue the same task. A new top-level message starts a new one.
- Never paste secrets, tokens or long logs; link the run instead.
`,
};

export const LINEAR_SKILL: SkillDoc = {
  name: "linear",
  description: "Read and update Linear issues: fields, states, relations and comments.",
  body: `# Linear

The tracking issue lives in Linear. Kiln mirrors state changes (in progress when building, done on merge); you write the content.

## Finding issues
- The issue key looks like \`ENG-123\`; the request or the brief names it.
- Before creating an issue, search the team's open and recently closed issues for the same subject.

## Writing an issue
- Title: what is wrong or what is wanted, in under ten words.
- Description sections: Description, Reproduction (bugs), Acceptance criteria (a checklist), Proposed direction, References (links to threads, pull requests, specs).
- Estimate: XS=1, S=2, M=3, L=5, XL=8 points.
- Relations: "blocks"/"blocked by" for real dependencies, "duplicate of" when you adopt an existing issue, "related" otherwise.

## Updating
- Comment when the work moves (spec ready, pull request open, merged) with the link.
- Never close an issue yourself; it closes when the pull request merges or a person confirms.
`,
};

export const JIRA_SKILL: SkillDoc = {
  name: "jira",
  description: "Read and update Jira issues: fields, transitions, links and comments.",
  body: `# Jira

The tracking issue lives in Jira. Kiln moves it through workflow transitions it knows (in progress, done); you write the content.

## Finding issues
- Keys look like \`PROJ-123\`. Search with JQL before creating: \`project = PROJ AND text ~ "<words>" ORDER BY updated DESC\`.

## Writing an issue
- Summary: under ten words.
- Description (Jira wiki markup): h3. Description, h3. Reproduction, h3. Acceptance criteria (\`* \` list), h3. Proposed direction, h3. References.
- Story points: XS=1, S=2, M=3, L=5, XL=8. Set components and labels the project uses; add \`factory\` for factory work.
- Links: "blocks", "is blocked by", "duplicates", "relates to".

## Updating
- Comment on each milestone with a link (spec, pull request, merge).
- Leave resolution to the workflow; never resolve an issue by hand.
`,
};

export const CODE_REVIEW_SKILL: SkillDoc = {
  name: "code-review",
  description: "The review rubric, severities and blocking rules, and the template for a posted review.",
  body: `# Code review

## What to check
1. **Correctness**: the change does what the issue and spec ask, including edge cases (empty, large, concurrent, failure paths).
2. **Security**: input validation, authorization checks, secrets, injection, unsafe deserialization, dependency risk.
3. **Data**: migrations are reversible or guarded; no data loss; personal data handled as the codebase does elsewhere.
4. **Tests**: new behavior is tested; bug fixes have a regression test that failed before the fix; tests check behavior, not implementation details.
5. **Maintainability**: follows the codebase's patterns and names; no dead code, duplicated logic or needless abstraction.
6. **Operations**: errors are logged usefully; performance is acceptable on realistic data; feature flags and config are documented.
7. **Proof**: interface changes have visual proof for every acceptance criterion (see \`ui-verification\`).

## Severity
- **Blocking**: wrong behavior, security or data risk, missing tests for new behavior, missing or mismatched visual proof, a broken build.
- **Major**: likely bugs on edge cases, clear maintainability problems.
- **Minor**: naming, small clean-ups. Never block on these alone.

## Each finding
\`<file>:<line> — <severity> — <problem>. Impact: <what goes wrong>. Fix: <the correction>.\`
Mark it **clear** (anyone can fix it) or **needs a decision** (a person must choose).

## Posting a review (foreman only)
Post one review with only the findings that need a decision, no approval and no rejection:

\`\`\`markdown
**Review notes from the factory**

These need your decision before merging:

1. \`src/billing/invoice.ts:88\` — Rounding now happens per line instead of per invoice. Totals can differ by a cent from the old behavior. Keep per-line (matches the spec) or restore per-invoice?

Everything else was addressed in the pull request.
\`\`\`
`,
};

export const UI_VERIFICATION_SKILL: SkillDoc = {
  name: "ui-verification",
  description: "Prove interface changes with screenshots and recordings per acceptance criterion.",
  body: `# UI verification

Visual proof shows a reviewer the change works without running it. Every acceptance criterion that a person can see gets proof.

## Capture standard
- One recording (WebM or MP4) per criterion, named after it: \`AC1-saved-carts-appear.webm\`. A screenshot (PNG) is enough for static states.
- Start from a clean state, show the path a user takes, end on the result. Keep recordings under a minute; trim waiting.
- Use realistic data, the default viewport (1280×800) and, when the change is responsive, one mobile size (390×844).
- Save files in \`.kiln/artifacts/\`. Kiln attaches them to the pull request. Never commit them to the repository.

## How
1. Start the app the way the repository documents (\`npm run dev\`, \`docker compose up\`, …) and wait until it answers.
2. With Playwright: \`npx playwright test --project=chromium\` with \`video: "on"\` and \`screenshot: "on"\`, tests titled \`AC1: …\`, \`AC2: …\`; copy the files from \`test-results/\` to \`.kiln/artifacts/\`.
3. Without tests, script the path with Playwright's API (\`page.goto\`, \`page.getByRole(...).click()\`, \`page.screenshot({ path })\`) and record with \`recordVideo\`.

## Checking someone else's proof
Proof that shows the wrong path, an incomplete state or misses a criterion counts as missing. Say which criterion and what the proof shows instead.
`,
};
