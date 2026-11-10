import { parseFrontmatter, slugify, stringifyFrontmatter } from "@/lib/frontmatter";

export type ScorerLabel = { value: string; score: number; description?: string };
export type ScorerAgent = { name: string; includeDescendants: boolean };

export type ScorerModel = {
  /** Directory under scorers/; the scorer's identity. */
  slug: string;
  name: string;
  description?: string;
  agents: ScorerAgent[];
  labels: ScorerLabel[];
  passingScore: number;
  samplingRate: number;
  model: string;
  selfImprovement: boolean;
  runner?: string;
  secrets?: string[];
  mcpServers?: string[];
  /** Judge instructions (the Markdown body). */
  rubric: string;
  extra: Record<string, unknown>;
};

const KNOWN = new Set(["name", "description", "agents", "labels", "passingScore", "samplingRate", "model", "selfImprovement", "runner", "secrets", "mcpServers", "output"]);

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);

export function parseScorer(slug: string, md: string): ScorerModel {
  const { data, body } = parseFrontmatter(md);
  const agentsRaw = Array.isArray(data.agents) ? data.agents : typeof data.agents === "string" ? [data.agents] : [];
  const agents = agentsRaw.map((a) => (typeof a === "string" ? { name: a, includeDescendants: false } : { name: String((a as { name?: unknown }).name ?? ""), includeDescendants: Boolean((a as { includeDescendants?: unknown }).includeDescendants) }));
  const labels = (Array.isArray(data.labels) ? data.labels : []).map((l) => {
    const o = l as Record<string, unknown>;
    return { value: String(o.value ?? ""), score: num(o.score, 0), ...(o.description ? { description: String(o.description) } : {}) };
  });
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN.has(k)) extra[k] = v;
  if (data.output !== undefined) extra.output = data.output;
  return {
    slug,
    name: String(data.name ?? slug),
    description: data.description ? String(data.description) : undefined,
    agents,
    labels,
    passingScore: num(data.passingScore, 0.5),
    samplingRate: num(data.samplingRate, 25),
    model: String(data.model ?? ""),
    selfImprovement: data.selfImprovement === true,
    runner: data.runner ? String(data.runner) : undefined,
    secrets: Array.isArray(data.secrets) ? data.secrets.map(String) : undefined,
    mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers.map(String) : undefined,
    rubric: body.replace(/^\n+/, "").replace(/\s+$/, ""),
    extra,
  };
}

export function serializeScorer(s: ScorerModel): string {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const data: Record<string, unknown> = {
    name: s.name,
    description: s.description || undefined,
    agents: s.agents.map((a) => (a.includeDescendants ? { name: a.name, includeDescendants: true } : a.name)),
    labels: s.labels.map((l) => ({ value: l.value, score: round2(l.score), ...(l.description ? { description: l.description } : {}) })),
    passingScore: round2(s.passingScore),
    samplingRate: round2(s.samplingRate),
    model: s.model,
    selfImprovement: s.selfImprovement,
    runner: s.runner || undefined,
    secrets: s.secrets?.length ? s.secrets : undefined,
    mcpServers: s.mcpServers?.length ? s.mcpServers : undefined,
    ...s.extra,
  };
  return stringifyFrontmatter(data, s.rubric);
}

/** Problems that block saving, keyed by field. */
export function scorerProblems(s: ScorerModel): Partial<Record<"name" | "agents" | "rubric" | "model" | "labels" | "passingScore" | "samplingRate", string>> {
  const p: ReturnType<typeof scorerProblems> = {};
  if (!s.name.trim()) p.name = "Name is required.";
  if (!s.agents.length) p.agents = "Choose at least one agent.";
  if (!s.rubric.trim()) p.rubric = "Judge instructions are required.";
  if (!s.model.trim()) p.model = "Choose a judge model.";
  if (!s.labels.length) p.labels = "Add at least one classification.";
  else if (s.labels.length > 20) p.labels = "Use at most 20 classifications.";
  else if (new Set(s.labels.map((l) => l.value)).size !== s.labels.length) p.labels = "Classification names must be unique.";
  if (!(s.passingScore >= 0 && s.passingScore <= 1)) p.passingScore = "Use a value from 0 to 1.";
  if (!(s.samplingRate >= 0 && s.samplingRate <= 100)) p.samplingRate = "Use a value from 0 to 100.";
  return p;
}

/** Self-improvement needs a failing classification to learn from. */
export function canSelfImprove(s: Pick<ScorerModel, "labels" | "passingScore">): boolean {
  return s.labels.some((l) => l.score < s.passingScore);
}

export function scorerPath(tree: Record<string, string>, slug: string): string | undefined {
  const p = `scorers/${slug}/scorer.md`;
  return p in tree ? p : undefined;
}

export function scorerSlugs(tree: Record<string, string>): string[] {
  return Object.keys(tree)
    .map((p) => /^scorers\/([^/]+)\/scorer\.md$/.exec(p)?.[1])
    .filter((x): x is string => Boolean(x))
    .sort((a, b) => a.localeCompare(b));
}

export function newScorerSlug(name: string, existing: string[]): string {
  const base = slugify(name) || "scorer";
  let slug = base;
  for (let i = 2; existing.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function emptyScorer(model = ""): ScorerModel {
  return { slug: "", name: "", agents: [], labels: [], passingScore: 1, samplingRate: 75, model, selfImprovement: false, rubric: "", extra: {} };
}

/** The five scorers every factory starts with. */
export const DEFAULT_SCORERS: Omit<ScorerModel, "agents" | "model" | "extra">[] = [
  {
    slug: "verbosity",
    name: "Verbosity",
    description: "Whether the agent's written, text output was proportionate to the work.",
    labels: [
      { value: "proportionate", score: 1, description: "The agent's output matched the work: most messages said what happened and what comes next, nothing was repeated or restated, and nothing the recipient needed was omitted." },
      { value: "verbose", score: 0.2, description: "The agent padded its output repeatedly: preamble restating the request, narration of what it was about to do, summaries re-describing a visible diff, filler in place of plain statements, or a PR description that outstrips the diff it describes." },
      { value: "terse", score: 0.1, description: "The agent under-communicated: it went silent through long stretches of work, finished without saying what changed or needs review, or dropped information the recipient needed to act." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: false,
    rubric: "**Rubric**\n\nEvaluate the agent's natural-language output to a human or another agent: status updates, progress messages, completion summaries, and prose in pull requests, reviews, or tracker comments. Not about diff size or tool-output length; code comment volume is scored under Code Quality. Judge from the recipient's perspective: someone who needs to know what happened and what to do next. The bullets below are common patterns, not an exhaustive checklist. Judge anything else that leaves output disproportionate to the work.\n\n**Assess:**\n\n- **Proportionality.** Prose volume matched the complexity of the work. Judge a PR description against the diff it describes, not against the rest of the run. A bloated body on top of otherwise tight status updates is still `verbose`.\n- **Padding.** Preamble restating the request, narrating what is about to happen, closing summaries that re-describe a visible diff, or an optional template section kept only because the template listed it. A section the template requires is exempt, but an unnecessarily elaborate answer to it is still padding.\n- **Redundancy.** Re-explaining the same point across messages, or summarizing a summary.\n- **Inflation.** Filler, hedging, and embellishment (\"comprehensive\", \"robust\") in place of a plain statement.\n- **Under-communication.** Long silent stretches, a completion message that does not say what changed or needs review, or dropped information the recipient needed.\n- **Channel discipline.** Using an unrequested summary file to communicate when a message was the right vehicle.\n\n**Reason**\n\nOne to three sentences quoting one representative passage (a padded opener, a redundant summary, a thin completion message) or, for `proportionate`, what kept it tight.",
  },
  {
    slug: "task-compliance",
    name: "Task Compliance",
    description: "Whether the agent fulfilled the mandate of its assigned factory role and did what the user or its orchestrating agent asked.",
    labels: [
      { value: "fully_compliant", score: 1, description: "The agent did everything its role and directives required, and surfaced any deviation." },
      { value: "mostly_compliant", score: 0.8, description: "The agent delivered a usable result and met all significant directives, with only minor gaps." },
      { value: "insufficient_evidence", score: 0.5, description: "The task description is unclear or incomplete, making it impossible to judge compliance." },
      { value: "noncompliant", score: 0.2, description: "The agent left meaningful work undone, missed or half-did a directive, violated an explicit constraint, ignored a correction, or misreported its work." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nThis scorer covers both facets of \"did the agent do the job it was assigned\": fulfilling its factory role's playbook (triage, spec, implementation, review, or foreman) and following the explicit directives, corrections, and constraints it received from the user or its orchestrating agent. Judge primarily on outcome: did the agent deliver what its role and its instructions both call for? Judge against the playbook and directives the transcript shows the agent actually had, not an idealized process. The bullets below are common ways either facet goes unmet, not an exhaustive checklist.\n\n**Assess:**\n\n- **Role fulfillment.** Did the agent produce what its playbook says the role exists to produce, to a standard the next step can build on, and not just go through the motions?\n- **Directive coverage.** Every directive from the task prompt or later messages acted on, including ones stated once or buried in a longer message.\n- **Completeness.** Carried to the end, or stopped at the first plausible resting point (some issues triaged, some criteria specified, some of the diff reviewed)?\n- **Scope.** Did what was asked and no more. Unrequested refactors, extra files, and self-assigned follow-on work are violations even when the extra work is good.\n- **Required artifacts.** Delivered in the expected place and shape: spec doc, pull request, review comments, tracker state. Work that exists only in the agent's own transcript is not delivered.\n- **Hard constraints and gates.** Explicit prohibitions (\"don't push\", \"ask before X\", \"draft PR only\") carry the most weight, as do playbook gates: not self-approving its own output, and not advancing the loop past work it does not own or taking over a downstream role.\n- **Bad instructions.** An ambiguous, wrong, or impossible directive should be surfaced with a defensible path taken, not silently reinterpreted or dropped.\n- **Corrections.** Adopted promptly and completely; reverting to already-corrected behavior is a serious failure.\n- **Truthful reporting and resumability.** The final report matches what was actually done (claiming untested or unfinished work as complete is a failure here, not a communication one) and state is left where the next agent or the user will look for it.\n\nOut of scope: craftsmanship of the output (scored under Code Quality), and standing rules or skill requirements (scored under Procedure Compliance).\n\n**Reason**\n\nOne to three sentences naming whether the gap was in the role mandate, the instructions, or both, quoting the playbook expectation or directive at issue. If unfulfilled, name what would have prevented it: a clearer playbook, a missing tool, a clearer instruction, an earlier check. For `insufficient_evidence`, say exactly what role, playbook, or directive context was missing.",
  },
  {
    slug: "procedure-compliance",
    name: "Procedure Compliance",
    description: "Whether the agent complied with the standing rules delivered through system context and invoked and followed through on the skills its situation called for.",
    labels: [
      { value: "fully_compliant", score: 1, description: "The agent followed every applicable rule and followed through on every triggered skill." },
      { value: "mostly_compliant", score: 0.8, description: "The agent followed all significant rules and skills, slipping only on something low-stakes." },
      { value: "noncompliant", score: 0.2, description: "The agent missed an applicable rule, skipped a triggered skill, breached a protective rule, or skipped required validation while reporting work complete." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nThe agent operates under two kinds of externally prescribed guidance: standing rules delivered through system context (user rules, repository rules such as CLAUDE.md or AGENTS.md, directory-scoped rules) and a catalogue of skills, each with stated triggers and requirements. Both are binding once they apply. Evaluate whether the agent honored every rule that applied to what it actually did, and invoked and followed through on every skill its situation clearly triggered. Judge only rules and skills the transcript shows were in scope. The categories below illustrate the range, not an exhaustive list.\n\n**Assess:**\n\n- **Applicability.** Judge only rules and skills that came into scope: a pull-request rule only if it opened one, a skill only if its trigger was clearly met. If the transcript shows no applicable rules or skills at all, grade `fully_compliant`.\n- **Mechanical rules.** Branch naming, commit attribution, required checks before pushing, pull request templates, protected branches. Unambiguous and cheap to follow, so a violation is strong signal; a multi-part rule is not satisfied by doing only one part.\n- **Judgement rules.** Comment style, error handling, communication conventions. Judge intent, not exact wording.\n- **Protective rules.** Guards against harm or irreversibility (no committing to protected branches, no force-push, no destructive commands, no approve or merge by an agent) carry the highest weight; a single breach here is disqualifying.\n- **Skill invocation.** A skill was used when its trigger was clearly met, not hand-rolled around. Missing a skill that exists to prevent a known mistake is the worse case.\n- **Skill adherence.** Once in play, a skill's required steps, constraints, designated tooling, and output format were followed to completion. Skipping a skill's verification or cleanup step while reporting the work done is a serious failure.\n- **Conflicts and failures.** A conflict between rules, or between a rule and an instruction, should be surfaced and resolved explicitly, not silently picked. When a skill's steps failed, the agent diagnosed and resolved it rather than silently abandoning the skill.\n\nOut of scope: the entrypoint playbook and task-specific instructions (scored under Task Compliance), and whether a rule or skill is itself well designed.\n\n**Reason**\n\nOne to three sentences naming the specific rules or skills evaluated, whether the gap (if any) was a rule breach, a missed invocation, or an adherence failure, and what would have prevented it.",
  },
  {
    slug: "efficiency",
    name: "Efficiency",
    description: "Whether the agent reached its result without wasted steps, rework or cost.",
    labels: [
      { value: "highly_efficient", score: 1, description: "The agent took a direct path: nothing re-read or re-run, independent steps batched, no work redone." },
      { value: "mostly_efficient", score: 0.8, description: "The agent slipped once or twice (a duplicated read, an early retry, a small correction) with no knock-on cost." },
      { value: "mostly_inefficient", score: 0.4, description: "The agent wasted effort repeatedly, or caused a round of rework an earlier check would have prevented." },
      { value: "highly_inefficient", score: 0.2, description: "The agent's waste dominated the run: the same defect reworked across cycles, repeated user correction, or extended flailing or looping." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: false,
    rubric: "**Rubric**\n\nEvaluate the full cost of reaching the result using recorded cost, duration, and tool-call metrics when present, plus the steps the agent took, rework it caused elsewhere in the loop, and human attention it consumed. Score against what a competent engineer with the same tools would have needed, not against what was achievable with only what the agent happened to have. A mistake that looks unavoidable in context still counts if better tooling, a skill, or a check would have prevented it; name that cause in the reason. The bullets below are common sources of waste, not an exhaustive checklist.\n\n**Assess:**\n\n- **Rework from mistakes.** Work redone because the agent got it wrong the first time: a review or CI failure a local check would have caught, edits to the wrong file, a misread requirement later reverted.\n- **Iteration cycles.** In a coordinating run, the round trips needed to reach an acceptable result: repeated implement-and-review cycles, work bounced back for the same defect. Attribute the cost to this run where its own choices caused it (an underspecified brief, unchecked acceptance of work).\n- **Cost to the human.** Repeated correction or steering from the user is the most expensive waste. A question asked up front is cheap; the same question asked after building the wrong thing is not.\n- **Information gathering.** Re-reading, re-running, or re-searching for something already found; reading a large file end to end when a targeted search would answer it.\n- **Routine-step overhead.** A roundabout way of doing a standard, repeated part of this agent's job when a more direct path was available. Weight this beyond its one-run cost: the same overhead recurs on every future run of the same type.\n- **Batching.** Independent reads, searches, or workstreams run serially across turns instead of together.\n- **Flailing.** Retrying a failing approach unchanged, or guessing when reading the code or docs would have settled it.\n- **Verification timing.** Checks run once, early enough to catch a defect before handoff, not deferred until after or re-run redundantly.\n\n**Reason**\n\nOne to three sentences naming the dominant source of waste with a rough count (three review cycles, four redundant reads, two repeated user corrections), and the likely fixable cause: a missing skill, an ambiguous playbook step, a late check.",
  },
  {
    slug: "code-quality",
    name: "Code Quality",
    description: "Whether the code the agent produced is something a careful senior reviewer would merge.",
    labels: [
      { value: "approve", score: 1, description: "The agent produced well-designed, correct code that is consistent with repo conventions, adequately tested, and clean of smells; a senior reviewer would approve it outright, with at most trivial nits." },
      { value: "insufficient_evidence", score: 0.5, description: "The transcript shows no code diff, or too little of one to judge." },
      { value: "block", score: 0.2, description: "The agent produced code with at least one defect a reviewer would insist on fixing before merge: a correctness or concurrency bug, a missed edge case, an inconsistent pattern, weak or missing tests, or mixed-in artifacts that do not belong." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nThis scorer applies to agent runs that produce code. Evaluate the actual code artifact (the diff itself, not the process used to produce it). Judge it the way a careful senior reviewer would review the same pull request, using the target repository's own established conventions as the standard. The verdict is binary: `approve` means that reviewer would merge the diff as-is, with at most trivial nits; if they would insist on a fix before merging (one real defect is enough), the verdict is `block`. The bullets below are common quality dimensions, not an exhaustive checklist.\n\n**Assess:**\n\n- **Design.** The shape of the change fits the codebase; it is not premature abstraction, scope creep, or a change that belongs somewhere else (a library, a config value, a separate service).\n- **Correctness.** The change does what it claims, including edge cases (empty inputs, boundaries) and concurrency safety (races, unsafe shared state).\n- **Complexity.** No function, type, or expression is doing more than it needs to; no speculative genericity or indirection added for a need that does not exist yet.\n- **Repo conventions.** Follows the same idioms as similar code in the same package: error handling, type placement, module boundaries, and any other established pattern. An unexplained deviation from a clear local pattern is a defect even if the new code works.\n- **Code smells.** Magic numbers or strings without a named constant, copy-paste that should be a shared function, commented-out code, vague or stale TODOs, workarounds that patch a symptom instead of the root cause, silently swallowed errors, deep nesting that early returns would flatten.\n- **Tests.** Present for the change, and actually verify the behavior they claim to (a broken implementation would fail them) rather than asserting trivia or mocking away the logic under test; cover the error and edge paths, not just the happy path; not so tightly coupled to internals that unrelated changes would break them.\n- **Naming.** Every new identifier communicates what it represents, at a length that is unambiguous without being noisy.\n- **Comments.** Explain why, not what. When the names already say how the code works, a comment saying it again is a defect, as is a narration of the syntax line by line. No comment describes an edit or a prior state of the code rather than its current behavior; an existing comment is not deleted or rewritten by a change unrelated to it.\n- **Diff hygiene.** The diff contains only the changes intended to be committed: no temporary text, screenshots, scratch scripts, or other verification scaffolding.\n- **Documentation.** READMEs, guides, or API docs are updated in the same change when the change affects how the software is built, tested, or used.\n- **Corrections.** A defect the orchestrator raised mid-run (relaying a finding from code review or a report from the user) counts against the artifact regardless of whether it was ultimately fixed. Judge only genuinely corrective content, not a routine status update or handoff note.\n\nOut of scope: whether the implementation process followed the playbook or did what was asked (scored under Task Compliance), and rule-following and skill use, including mechanical conventions like commit format or branch naming (scored under Procedure Compliance).\n\n**Reason**\n\nOne to three sentences citing the specific file, pattern, or defect that drove the grade; quote or closely paraphrase the line or convention at issue. Name what would have caught it: a lint rule, a repo convention the agent should have searched for, a test case. For `insufficient_evidence`, say what you could not see, for example that no diff was produced or the diff was not in the transcript.",
  },
];

/** Default agents for a built-in scorer: Code Quality grades implementers, the rest grade everyone. */
export function defaultScorerAgents(slug: string, agents: { name: string; agentType: string }[]): string[] {
  if (slug === "code-quality") {
    const impl = agents.filter((a) => a.agentType === "IMPLEMENT").map((a) => a.name);
    return impl.length ? impl : agents.slice(0, 1).map((a) => a.name);
  }
  return agents.map((a) => a.name);
}
