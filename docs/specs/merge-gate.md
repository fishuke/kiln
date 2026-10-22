# Merge gate (contract)

Decision: [ADR-014](../adr/0014-merge-gate.md). Related: [ADR-006](../adr/0006-decision-layer.md) (typed decisions), [ADR-008](../adr/0008-humans-merge.md) (agents never merge), [Studio](studio.md).

When a person marks a pull request **Ready for review**, Kiln runs the `merge-safety` decision on it. If the decision's action is `merge`, the merge gate merges the pull request. Any other answer sends it to a person: it appears in the Inbox of the App's or factory's reviewers with the decision's reasons. The gate is off by default; with it off, every pull request goes to a person and no decision runs.

There are exactly two outcomes: **merged** and **needs review**.

## Who builds what

| Area                                                                                                                    | Owner                                       |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `merge-safety` built-in decision and its offline heuristic (`packages/decide`)                                          | merge gate                                  |
| `GateMerger` capability with Fake and GitHub implementations (`packages/integrations/src/merge-gate.ts`)                | merge gate                                  |
| `MergeGateService` (`packages/engine/src/merge-gate.ts`), Inbox items, audit entries, `merge_gate.review_updated` event | merge gate                                  |
| `apps/api/src/routes/merge-gate.ts` and the wiring in `apps/api/src/config.ts`                                          | merge gate                                  |
| Calling the gate when a Studio pull request becomes `ready_for_review`, and following `merge_gate.review_updated`       | studio (ship, `packages/studio/src/ship/*`) |
| Showing the outcome in Studio and the new Inbox kind                                                                    | web                                         |

## The `merge-safety` decision

Built in like the others (`BUILTIN_DECISIONS["merge-safety"]`); a factory replaces it with `decisions/merge-safety.yaml`.

```yaml
state: [title, author, files, areas, additions, deletions, diff, checks, tests, preview, findings]
questions:
  safe_to_merge: { type: probability }
  risk_tier: { type: choice, options: [low, medium, high] }
  touches_sensitive_area: { type: probability }
policy:
  review: "checks != 'success' or tests == 'failed' or preview == 'failed' or touches_sensitive_area >= 0.3 or risk_tier.high >= 0.3"
  merge: "safe_to_merge >= 0.9 and risk_tier.low >= 0.7"
on_error: llm
timeout_ms: 800
```

| State field              | Value                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `title`, `author`        | The pull request's title and author on the forge.                                                              |
| `files`                  | Changed paths.                                                                                                 |
| `areas`                  | The parts of the app it touches: what the caller passes, else the distinct first two path segments of `files`. |
| `additions`, `deletions` | Line counts.                                                                                                   |
| `diff`                   | The unified patches, cut to 20,000 characters.                                                                 |
| `checks`                 | `success`, `failure`, `pending` or `none` (no check runs), from `Forge.checks` on the head commit.             |
| `tests`, `preview`       | `passed`/`failed`/`none` and `ready`/`failed`/`none`, as the caller reports them; `none` when not given.       |
| `findings`               | Review findings as `"<severity>: <text>"`.                                                                     |

- The gate merges only when the action is `merge`. Any other action (`review`, or `allow` when no entry matched) means needs review.
- `review` is first, so a decision no provider answered fails closed to `review`.
- Providers are the server's usual ones: Jev, then the LLM fallback; the fake provider's heuristic answers offline. The heuristic says safe (0.92, `low`) only when checks passed, tests and preview did not fail, there is no `high` finding, at most 300 lines changed and no file looks sensitive (auth, sessions, passwords, payments, billing, secrets, tokens, migrations, CI workflows, `.env*`, Dockerfiles, infrastructure, dependency manifests and lockfiles); otherwise 0.2 and `high` for a sensitive file, `medium` otherwise.
- Self-improvement never changes `decisions/merge-safety.yaml`: proposals that touch it are dropped like `policies/` changes.

## Turning the gate on

Off by default. Only people change it.

- **Factory:** `mergeGate: true` in a file under `policies/` (the `Policy` schema gains `mergeGate?: boolean`). If any policy file says `false`, it's off. Agents and self-improvement can't change `policies/`.
- **App:** `PUT /api/v1/merge-gate/apps/{appId}` with `{ enabled }`, by a team owner or admin signed in as a person (session or personal key). Stored in `merge_gate_settings` (id `app:<appId>`): `{ id, appId, team, enabled, updatedBy, updatedAt }`. Every change is audited (`merge_gate.enabled` / `merge_gate.disabled`).

An App has no `decisions/` directory, so it uses the built-in `merge-safety` decision as is.

## Merge capability (`packages/integrations/src/merge-gate.ts`)

```ts
export type GateMergeInput = { repo: RepoRef; number: number; expectedHeadSha: string; title: string };
/** The only code path in Kiln that merges without a person. Held by MergeGateService only. */
export interface GateMerger {
  readonly identity: string; // the account the forge records as merger
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

- `merge` is not on `Forge`, `PersonForge`, `KilnOptions.forge` or anything a run can reach. `GateMerger` is passed as `KilnOptions.gateMerger` and kept in a private field of `MergeGateService`; nothing else reads it (a structural test checks the source).
- GitHub: `PUT /repos/{o}/{r}/pulls/{n}/merge` with `{ sha: expectedHeadSha, merge_method: "merge", commit_title }`. 405, 409 and 422 become `GateMergeConflict`. The token is `KILN_MERGE_GATE_TOKEN`, a credential separate from the forge's and from every sandbox token. Without it the GitHub server has no `GateMerger`.
- Fake: refuses when the head moved or the pull request isn't open; merges with the identity `kiln-merge-gate`.
- Run tokens never gain merge permission: `SCOPES` and the run-token allowlist are unchanged, and none of the merge gate's routes accepts a run token.

## Service (`packages/engine/src/merge-gate.ts`)

```ts
export const MergeGateScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("app"), appId: z.string().min(1), team: z.string().min(1) }),
  z.object({ kind: z.literal("factory"), factory: z.string().min(1) }),
]);
export const ReadyForReview = z.object({
  scope: MergeGateScope,
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/), // "owner/name"
  number: z.number().int().positive(),
  by: z.string().min(1), // the person who marked it ready
  areas: z.array(z.string().max(200)).max(50).optional(),
  tests: z.enum(["passed", "failed", "none"]).optional(),
  preview: z.object({ url: z.string().url().optional(), status: z.enum(["ready", "failed", "none"]) }).optional(),
  findings: z
    .array(z.object({ severity: z.enum(["low", "medium", "high"]), text: z.string().max(2000) }))
    .max(100)
    .optional(),
  link: z.string().url().optional(), // where a reviewer opens it (the Studio App)
  pullRequestId: z.string().optional(), // Studio's AppPullRequest id ("sp_…")
});

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
  reasons: string[]; // plain sentences for the Inbox and Studio
  decision?: { logId: string; action: string; answers: Answers; provider: string; fellBack: boolean };
  mergedBy?: string; // the gate's identity, or the person who merged later
  previewUrl?: string;
  link?: string;
  pullRequestId?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
};

export class MergeGateService {
  enabled(scope: MergeGateScope): boolean;
  setAppEnabled(input: { appId: string; team: string; enabled: boolean; by: string }): MergeGateSetting;
  readyForReview(input: ReadyForReview): Promise<MergeReview>;
  /** The forge reports the pull request merged or closed (webhook, Studio cancel, a person's merge). */
  pullRequestClosed(input: { repo: string; number: number; merged: boolean; by?: string }): MergeReview[];
  get(id: string): MergeReview | undefined;
  list(filter: { team?: string; factory?: string; state?: MergeReviewState[] }): MergeReview[];
}
export class MergeGateError extends Error {
  code: "not_found" | "invalid";
}
```

`readyForReview`:

1. Validate with `ReadyForReview`. An open review for the same `repo#number` and head commit is returned as is (calling twice is safe).
2. Read the pull request. Not open or a draft: `MergeGateError("invalid")`.
3. Persist the review as `deciding`.
4. Gate off: `needs_review` with the reason "The merge gate is off, so a person reviews every pull request." No decision runs.
5. Gate on: read files and checks, run `merge-safety` (the factory's override, else the built-in), and log it with `logDecision`.
6. Action `merge` and the server has a `GateMerger`: merge with the head commit the decision saw. Success: `merged`, audit `merge_gate.merged`. `GateMergeConflict` or any other merge error: `needs_review` with the error as a reason, audit `merge_gate.merge_failed`.
7. Action `merge` without a `GateMerger`: `needs_review`, reason "This server has no merge credential for the gate (KILN_MERGE_GATE_TOKEN)."
8. Anything else: `needs_review`, reasons from the decision (below), audit `merge_gate.sent_to_review`.
9. Persist and publish `merge_gate.review_updated`.

Every step persists before and after; time comes from `kiln.clock`.

Reasons are short sentences built from the state and answers, for example "CI failed.", "Tests failed.", "It touches a sensitive area (0.80).", "Risk is high (0.70).", "Safe to merge: 0.55; it needs 0.90." When the decision had no answer: "The merge-safety decision could not answer: <error>."

## Audit entries

`kiln.audit(actor, action, target, details)` with target `mrv_…`:

| Action                                       | Actor                 | Details                                                                                                                                            |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge_gate.merged`                          | the merger's identity | `{ team?, factory?, appId?, repo, number, headSha, decisionLogId, decision: "merge-safety", state, answers, action, provider, fellBack, readyBy }` |
| `merge_gate.sent_to_review`                  | `kiln`                | the same, plus `reasons`                                                                                                                           |
| `merge_gate.merge_failed`                    | `kiln`                | the same, plus `error`                                                                                                                             |
| `merge_gate.enabled` / `merge_gate.disabled` | the person            | `{ team, appId }` (target `app:<appId>`)                                                                                                           |

`state` in the details is exactly what the decision saw.

## Inbox

Items come from reviews in `needs_review`:

| Field                            | Value                                                               |
| -------------------------------- | ------------------------------------------------------------------- |
| `id`                             | `merge:<review id>`                                                 |
| `kind`                           | `studio_pr_review` for an App, `pr_review` for a factory            |
| `title`                          | `Review: <pull request title>`                                      |
| `description`                    | The reasons, one per line                                           |
| `reasons`                        | The reasons                                                         |
| `url`                            | `link`, else the pull request URL                                   |
| `urls`                           | Pull request URL and preview URL                                    |
| `actions`                        | `["view"]`: the person reviews and merges on the forge or in Studio |
| `recipients`                     | App: the team's owners and admins. Factory: the `admins` role.      |
| `team`, `appId`, `mergeReviewId` | Set for App items; `factory` is unset for them                      |
| `urgency`                        | 0.5                                                                 |

`InboxItem.factory` becomes optional. The inbox route shows App items to members of their team. The item clears when the review leaves `needs_review` (`pullRequestClosed`, from the forge's merge webhook or from Studio).

## Event

```ts
"merge_gate.review_updated": { reviewId: string; appId?: string; factory?: string; pullRequestId?: string; repo: string; number: number; state: MergeReviewState; priority: "needs_you" | "finished" };
```

`needs_you` for `needs_review`, `finished` otherwise.

## API (`apps/api/src/routes/merge-gate.ts`)

Every route needs a person (session or personal key). Run tokens and agent keys get 403.

| Method and path                       | Body                                     | Response                                                                 |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/v1/merge-gate/apps/{appId}` |                                          | `{ appId, enabled }` (team member)                                       |
| `PUT /api/v1/merge-gate/apps/{appId}` | `{ enabled: boolean }`                   | `{ appId, enabled }` (team owner or admin)                               |
| `POST /api/v1/merge-gate/reviews`     | `ReadyForReview` minus `by` (the caller) | `MergeReview` (App: team member; factory: `decide:merge` on the factory) |
| `GET /api/v1/merge-gate/reviews`      | `?state=`                                | `{ reviews: MergeReview[] }` for the current team                        |
| `GET /api/v1/merge-gate/reviews/{id}` |                                          | `MergeReview`                                                            |

`MergeGateError` maps `not_found` → 404 and `invalid` → 400.

## How Studio's shipping calls it

See [Studio: merge gate](studio.md#merge-gate-adr-014). In short: when the author moves an `AppPullRequest` to `ready_for_review`, ship calls `StudioOptions.mergeGate.readyForReview(...)` and sets the pull request to `merged` when the result is `merged`. It follows `merge_gate.review_updated` for a later person's merge, and calls `pullRequestClosed` when the author cancels.

## Acceptance

1. With the gate off, Ready for review sends every pull request to the Inbox and runs no decision.
2. With it on, a small change with green checks is merged by the gate's identity; the audit entry holds the decision's inputs and answer.
3. A failing check, a sensitive file, a `high` finding or a provider failure sends it to the Inbox with reasons.
4. The gate merges only the head commit the decision saw.
5. Run tokens can't reach any merge gate route; `GateMerger` is referenced only by the service and the server wiring.
6. A person's later merge or the author's cancel clears the Inbox item.

## Not built here

- Calling the gate from the factory workflow's hand-off (the factory setting exists; the factory flow still opens its review gate as today).
- Tuning `merge-safety` per App (an App uses the built-in decision).
