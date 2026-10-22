# Merge gate (contract)

Decision: [ADR-014](../adr/0014-merge-gate.md). Related: [ADR-006](../adr/0006-decision-layer.md) (typed decisions), [ADR-008](../adr/0008-humans-merge.md) (agents never merge), [Studio](studio.md).

When a person marks a pull request **Ready for review**, Kiln runs the `merge-safety` decision on it. If the decision's action is `merge`, the merge gate merges the pull request. Any other answer sends it to a person: it appears in the Inbox of the App's or factory's reviewers with the reasons. The gate is off by default; with it off, every pull request goes to a person and no decision runs.

There are exactly two outcomes: **merged** and **review**.

## Who builds what

| Area                                                                                                                                         | Owner                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `merge-safety` built-in decision, its computed facts and offline heuristic (`packages/decide`)                                               | merge gate                                     |
| `GateMerger` capability with Fake and GitHub implementations (`packages/integrations/src/merge-gate.ts`)                                     | merge gate                                     |
| `MergeGateService` (`packages/engine/src/merge-gate.ts`): decision, merge, Inbox items, audit entries, the `merge_gate.review_updated` event | merge gate                                     |
| Read-only `apps/api/src/routes/merge-gate.ts`, the `gateMerger` wiring in `apps/api/src/config.ts`                                           | merge gate                                     |
| The App's `mergeGate` policy and `kiln.mergeGate.useAppPolicy(...)` registration                                                             | app definitions (with the API's Studio wiring) |
| Calling `readyForReview` when the author marks the App's pull request ready, and recording the outcome                                       | studio (ship)                                  |
| Showing the outcome in Studio and the `studio_pr_review` Inbox kind                                                                          | web                                            |

## The `merge-safety` decision

Built in like the others (`BUILTIN_DECISIONS["merge-safety"]`); a factory replaces it with `decisions/merge-safety.yaml`.

```yaml
state: [title, author, files, areas, additions, deletions, lines, sensitive_files, high_findings, diff, checks, tests, preview, findings]
questions:
  safe_to_merge: { type: probability }
  risk_tier: { type: choice, options: [low, medium, high] }
  touches_sensitive_area: { type: probability }
policy:
  review: "checks != 'success' or tests == 'failed' or preview == 'failed' or sensitive_files > 0 or high_findings > 0 or lines > 300 or touches_sensitive_area >= 0.3 or risk_tier.high >= 0.3"
  merge: "safe_to_merge >= 0.9 and risk_tier.low >= 0.7"
on_error: llm
timeout_ms: 800
```

| State field                       | Value                                                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `author`                 | The pull request's title and author on the forge.                                                                                                                                                                                             |
| `files`                           | Changed paths.                                                                                                                                                                                                                                |
| `areas`                           | The parts of the app it touches: what the caller passes, else the distinct first two path segments of `files`.                                                                                                                                |
| `additions`, `deletions`, `lines` | Line counts; `lines` is their sum.                                                                                                                                                                                                            |
| `sensitive_files`                 | How many changed paths are sensitive (`sensitivePaths` in `@kiln/decide`): auth, sessions, passwords, payments, billing, secrets, tokens, migrations, CI workflows, `.env*`, Dockerfiles, infrastructure, dependency manifests and lockfiles. |
| `high_findings`                   | How many review findings have severity `high`.                                                                                                                                                                                                |
| `diff`                            | The unified patches, cut to 20,000 characters.                                                                                                                                                                                                |
| `checks`                          | `success`, `failure`, `pending` or `none` (no check runs), from `Forge.checks` on the head commit.                                                                                                                                            |
| `tests`, `preview`                | `passed`/`failed`/`none` and `ready`/`failed`/`none`, as the caller reports them; `none` when not given.                                                                                                                                      |
| `findings`                        | Review findings as `"<severity>: <text>"`.                                                                                                                                                                                                    |

**Untrusted input.** The diff, title and description are written by agents and customers; a prompt injection there is the one path to an automatic merge. So `lines`, `sensitive_files`, `high_findings` and `checks` are computed in code (`mergeSafetyFacts`), and the built-in `review` rule tests them before any model answer, for every provider. The Anthropic and gateway prompts say the state is data and must not be followed as instructions. A model that is fooled can still mark a small, green, non-sensitive change safe; that is the risk a team accepts by turning the gate on.

- The gate merges only when the action is `merge`. Any other action (`review`, or `allow` when no entry matched) means review.
- `review` is first, so a decision no provider answered fails closed to `review`.
- Providers are the server's usual ones: Jev, then the LLM fallback; offline, the fake provider's heuristic says safe (0.92, `low`) only when checks passed, tests and preview did not fail, and the computed facts flag nothing.
- Self-improvement never changes `decisions/merge-safety.yaml`: proposals that touch it are dropped like `policies/` changes.

## Turning the gate on

Off by default. The switch is a policy, which only people edit; there is no runtime setting.

- **Factory:** `mergeGate: true` in a file under `policies/` (`Policy.mergeGate?: boolean`). If any policy file says `false`, it's off. Agents and self-improvement can't change `policies/`.
- **App:** `mergeGate` in the App definition's policies ([app-definitions](app-definitions.md)). The API registers the resolver once it builds App definitions: `kiln.mergeGate.useAppPolicy((appId) => appDefinitions.resolve(appId).mergeGate)`. Until it is registered, every App's gate is off. The App definition's built-in layer must default to `false` (ADR-014).

An App has no `decisions/` directory, so it uses the built-in `merge-safety` decision.

## Merge capability (`packages/integrations/src/merge-gate.ts`)

```ts
export type GateMergeInput = { repo: RepoRef; number: number; expectedHeadSha: string; title: string };
/** The only code path in Kiln that merges without a person. Held by MergeGateService only. */
export interface GateMerger {
  readonly identity: string; // used when the forge doesn't report who merged
  merge(input: GateMergeInput): Promise<PullRequest>;
}
export class GateMergeConflict extends Error {} // head moved, not mergeable, or not open
export class FakeGateMerger implements GateMerger {
  constructor(forge: FakeForge, identity?: string);
} // default "kiln-merge-gate"
export class GitHubGateMerger implements GateMerger {
  constructor(opts: { token: string; identity: string; baseUrl?: string; fetch?: typeof fetch });
}
```

- `merge` is not on `Forge`, `PersonForge` or anything a run can reach. `KilnOptions.gateMerger` goes straight into a private field of `MergeGateService`; `Kiln` does not keep it on `kiln.options`. A test fails if any other source file names `GateMerger`/`gateMerger`, or if the merger appears on `kiln.options`.
- GitHub: `PUT /repos/{o}/{r}/pulls/{n}/merge` with `{ sha: expectedHeadSha, merge_method: "merge", commit_title }`. 405, 409 and 422 become `GateMergeConflict`. The token is `KILN_MERGE_GATE_TOKEN`, a credential separate from the forge's and from every sandbox token. Without it a GitHub server has no `GateMerger`, and every pull request goes to a person.
- Fake: refuses when the head moved or the pull request isn't open; merges as `kiln-merge-gate`. Local mode (the git-backed forge) uses it.
- Run tokens never gain merge permission: `SCOPES` and the run-token allowlist are unchanged; a test fails if a run token may call any route that merges, approves or needs `decide:merge`.

## Service (`packages/engine/src/merge-gate.ts`)

```ts
export const MergeGateScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), appId: z.string().min(1), team: z.string().min(1) }),
  z.object({ kind: z.literal("factory"), factory: z.string().min(1) }),
]);
export const ReadyForReview = z.object({
  scope: MergeGateScope,
  repo: z.string(), // "owner/name"
  number: z.number().int().positive(),
  by: z.string().min(1), // the person who marked it ready
  areas: z.array(z.string().max(200)).max(50).optional(),
  tests: z.enum(["passed", "failed", "none"]).optional(),
  preview: z.object({ url: z.string().url().optional(), status: z.enum(["ready", "failed", "none"]) }).optional(),
  findings: z
    .array(z.object({ severity: z.enum(["low", "medium", "high"]), text: z.string().max(2000) }))
    .max(100)
    .optional(),
  link: z.string().url().optional(), // where a reviewer opens it (the App in Studio)
  pullRequestId: z.string().optional(), // Studio's AppPullRequest id ("sp_…")
});
export type MergeGateOutcome = { outcome: "merged"; review: MergeReview } | { outcome: "review"; reasons: string[]; review: MergeReview };

export type MergeReviewState = "deciding" | "merged" | "needs_review" | "closed";
export type MergeReview = {
  id: string; // "mrv_…"
  scope: MergeGateScope;
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  by: string;
  headSha: string;
  state: MergeReviewState;
  reasons: string[];
  decision?: { logId: string; action: string; answers: Answers; provider: string; fellBack: boolean };
  mergedBy?: string;
  previewUrl?: string;
  link?: string;
  pullRequestId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
};

export class MergeGateService {
  useAppPolicy(policy: (appId: string) => boolean): void;
  enabled(scope: MergeGateScope): boolean;
  readyForReview(input: ReadyForReview): Promise<MergeGateOutcome>;
  /** The pull request was merged or closed on the forge (webhook) or cancelled in Studio. */
  pullRequestClosed(input: { repo: string; number: number; merged: boolean; by?: string }): MergeReview[];
  get(id: string): MergeReview | undefined;
  list(filter: { team?: string; factory?: string; state?: MergeReviewState[] }): MergeReview[];
  inboxItems(): InboxItem[];
}
export class MergeGateError extends Error {
  code: "not_found" | "invalid";
}
```

`readyForReview`:

1. Validate with `ReadyForReview`. A review for the same scope, `repo#number` and head commit that isn't closed is returned as is; concurrent calls share one decision.
2. Read the pull request. Not found: `MergeGateError("not_found")`; not open or a draft: `MergeGateError("invalid")`.
3. Persist the review as `deciding`.
4. Gate off: `needs_review`, reason "The merge gate is off, so a person reviews every pull request." No decision runs.
5. Read files and checks. If the forge can't list files or a call fails, `needs_review` with "Kiln could not read the pull request to judge it: …" (fail closed).
6. Run `merge-safety` (the factory's override, else the built-in) and log it with `logDecision`.
7. Action `merge` and the server has a `GateMerger`: merge at the head commit the decision saw. Success: `merged`, audit `merge_gate.merged`. A merge error: `needs_review` with the error as the reason, audit `merge_gate.merge_failed`.
8. Action `merge` without a `GateMerger`: `needs_review`, reason "This server has no merge credential for the gate (KILN_MERGE_GATE_TOKEN)."
9. Anything else: `needs_review` with reasons, audit `merge_gate.sent_to_review`.
10. Each change persists the review and publishes `merge_gate.review_updated`.

Time comes from `kiln.clock`. Reasons are short sentences: the facts first ("CI failed.", "Tests failed.", "It changes sensitive files: lib/auth/session.ts.", "A review found a high-severity problem.", "It changes 420 lines."), then each answer ("Safe to merge: 0.55.", "Risk tier: high (0.70)."). With no answer: "The merge-safety decision could not answer: …".

## Audit entries

`kiln.audit(actor, action, target, details)` with target `mrv_…`:

| Action                      | Actor                            | Details                                                                                                                                            |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge_gate.merged`         | who the forge recorded as merger | `{ team?, appId?, factory?, repo, number, headSha, readyBy, decisionLogId, decision: "merge-safety", state, answers, action, provider, fellBack }` |
| `merge_gate.sent_to_review` | `kiln`                           | the same when a decision ran, plus `reasons` (and `error` when Kiln could not read the pull request)                                               |
| `merge_gate.merge_failed`   | `kiln`                           | the same, plus `error`                                                                                                                             |

`state` is exactly what the decision saw.

## Inbox

Items come from reviews in `needs_review`:

| Field                            | Value                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `id`                             | `merge:<review id>`                                                              |
| `kind`                           | `studio_pr_review` for an App, `pr_review` for a factory                         |
| `title`                          | `Review: <pull request title>`                                                   |
| `description`                    | The reasons, one per line                                                        |
| `reasons`                        | The reasons                                                                      |
| `url`                            | `link`, else the pull request URL                                                |
| `urls`                           | Pull request URL and preview URL                                                 |
| `actions`                        | `["view"]`: the person reviews and merges on the forge or in Studio              |
| `recipients`                     | App: the team's owners and admins. Factory: the `admins` role.                   |
| `team`, `appId`, `mergeReviewId` | Set for App items; `factory` is unset for them (`InboxItem.factory` is optional) |
| `urgency`                        | 0.5                                                                              |

The inbox route shows App items to members of their team (`InboxFilter.inTeam`). The item clears when the review leaves `needs_review`: the forge's `pull_request_merged` / `pull_request_closed` webhook (handled in `AutomationService`), or `pullRequestClosed` from Studio.

## Event

The one event for this transition; Studio's shipping emits no `needs_you` event of its own for it.

```ts
"merge_gate.review_updated": { reviewId: string; appId?: string; factory?: string; pullRequestId?: string; repo: string; number: number; state: MergeReviewState; priority: "needs_you" | "finished" };
```

`needs_you` for `needs_review`, `finished` otherwise.

## API (`apps/api/src/routes/merge-gate.ts`)

Read-only. Every route needs a person (session or personal key); run tokens and agent keys get 403. Nothing here turns the gate on or starts it.

| Method and path                         | Response                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/merge-gate/reviews?state=` | `{ reviews: MergeReview[] }` for the current team's Apps    |
| `GET /api/v1/merge-gate/reviews/{id}`   | `MergeReview` (404 outside the caller's teams or factories) |

## How Studio's shipping calls it

See [Studio: merge gate](studio.md#merge-gate-adr-014). The author marks the `AppPullRequest` ready for review; ship calls `readyForReview` and sets the pull request to `merged` or `waiting_for_review` (with `reasons`). It does not add an Inbox item or emit its own `needs_you` event.

## Acceptance

1. With the gate off, Ready for review sends every pull request to the Inbox and runs no decision.
2. With it on, a small change with green checks is merged by the gate; the audit entry holds the decision's inputs and answer.
3. A failing check, a sensitive file, a large change, a `high` finding or a provider failure sends it to the Inbox with reasons, whatever a model answers.
4. The gate merges only the head commit the decision saw.
5. Run tokens can't reach any route that merges; `GateMerger` is referenced only by the service, `Kiln` and the server wiring, and is not on `kiln.options`.
6. A person's later merge, a forge close or the author's cancel clears the Inbox item.

## Not built here

- Calling the gate from the factory workflow's hand-off (the factory policy switch exists; the factory flow still opens its own review gate).
- Tuning `merge-safety` per App (an App uses the built-in decision).
- Registering `useAppPolicy` in the API: it needs the App definitions resolver (app-definitions work).
