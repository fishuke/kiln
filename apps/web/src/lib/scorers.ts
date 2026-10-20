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
    description: "Whether the agent's messages and summaries are as short as they can be while still complete.",
    labels: [
      { value: "concise", score: 1, description: "Messages say what matters and stop; no repetition or filler." },
      { value: "somewhat_verbose", score: 0.5, description: "Useful content with noticeable padding, repetition or over-explanation." },
      { value: "verbose", score: 0, description: "Long, repetitive or padded output that buries the result." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nJudge the length of the agent's user-facing output against the information it carries. Penalize repetition, restating the task, narrating tool use, and long preambles. Do not penalize necessary detail such as reproduction steps or code.",
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
    rubric:
      "**Rubric**\n\nThis scorer covers both facets of \"did the agent do the job it was assigned\": fulfilling its factory role's playbook (triage, spec, implementation, review, or foreman) and following the explicit directives, corrections, and constraints it received from the user or its orchestrating agent.",
  },
  {
    slug: "procedure-compliance",
    name: "Procedure Compliance",
    description: "Whether the agent followed the factory's procedures: skills, repository instructions and required checks.",
    labels: [
      { value: "followed", score: 1, description: "Required skills, instructions and checks were followed." },
      { value: "minor_deviation", score: 0.5, description: "A non-essential step was skipped or done out of order." },
      { value: "violated", score: 0, description: "A required procedure was skipped or contradicted." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nCheck the run against the skills the agent loaded, the repository's agent instructions and the factory's required checks (tests, lint, evidence). Name the procedure and the step when you find a deviation.",
  },
  {
    slug: "efficiency",
    name: "Efficiency",
    description: "Whether the agent reached its result without wasted steps, retries or cost.",
    labels: [
      { value: "efficient", score: 1, description: "A direct path to the result with little wasted work." },
      { value: "acceptable", score: 0.7, description: "Some detours or redundant tool calls, but proportionate to the task." },
      { value: "wasteful", score: 0.3, description: "Repeated failed attempts, loops or unnecessary exploration." },
      { value: "runaway", score: 0, description: "The run looped or spent far beyond what the task needed." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nCompare the steps, tool calls, retries and cost of the run to what a competent engineer would need for the same task. Identify the largest source of waste.",
  },
  {
    slug: "code-quality",
    name: "Code Quality",
    description: "Whether the code the agent wrote is correct, tested, and fits the codebase.",
    labels: [
      { value: "high_quality", score: 1, description: "Correct, focused, tested, and consistent with the codebase's conventions." },
      { value: "needs_polish", score: 0.5, description: "Works but has gaps in tests, naming, structure or edge cases." },
      { value: "low_quality", score: 0, description: "Incorrect, untested, or at odds with the codebase." },
    ],
    passingScore: 0.5,
    samplingRate: 10,
    selfImprovement: true,
    rubric: "**Rubric**\n\nReview the diff the agent produced for correctness, test coverage of new behavior, readability, and consistency with surrounding code. Ignore style issues a formatter would fix.",
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
