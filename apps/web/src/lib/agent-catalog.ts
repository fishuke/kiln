/** Harnesses, models and hosts the agent and settings editors offer. Kiln is bring-your-own-keys. */

export type HarnessId = "claude-code" | "codex" | "opencode" | "gemini" | "pi";

export const HARNESSES: { id: HarnessId; label: string; authHint: string }[] = [
  { id: "claude-code", label: "Claude Code", authHint: "An Anthropic API key or a Claude subscription token (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`)." },
  { id: "codex", label: "Codex", authHint: "An OpenAI API key (OPENAI_API_KEY)." },
  { id: "opencode", label: "OpenCode", authHint: "The provider key OpenCode should use, e.g. ANTHROPIC_API_KEY or OPENROUTER_API_KEY." },
  { id: "gemini", label: "Gemini CLI", authHint: "A Gemini API key (GEMINI_API_KEY)." },
  { id: "pi", label: "Pi", authHint: "The provider key Pi should use." },
];

export const harnessLabel = (id: string) => HARNESSES.find((h) => h.id === id)?.label ?? id;

export type ModelOption = { id: string; label: string; harnesses: HarnessId[] };

const ALL: HarnessId[] = ["claude-code", "codex", "opencode", "gemini", "pi"];
const CLAUDE: HarnessId[] = ["claude-code", "opencode", "pi"];
const OPENAI: HarnessId[] = ["codex", "opencode", "pi"];
const GEMINI: HarnessId[] = ["gemini", "opencode", "pi"];

export const AUTO_MODELS: ModelOption[] = [
  { id: "auto", label: "auto (responsive)", harnesses: ALL },
  { id: "auto-efficient", label: "auto (cost-efficient)", harnesses: ALL },
  { id: "auto-genius", label: "auto (genius)", harnesses: ALL },
  { id: "auto-open", label: "auto (open-weights)", harnesses: ["opencode", "pi"] },
];

export const MODELS: ModelOption[] = [
  ...AUTO_MODELS,
  { id: "claude-opus-5-5", label: "claude opus 5.5", harnesses: CLAUDE },
  { id: "claude-sonnet-5-5", label: "claude sonnet 5.5", harnesses: CLAUDE },
  { id: "claude-haiku-5-5", label: "claude haiku 5.5", harnesses: CLAUDE },
  { id: "claude-opus-5", label: "claude opus 5", harnesses: CLAUDE },
  { id: "claude-sonnet-5", label: "claude sonnet 5", harnesses: CLAUDE },
  { id: "claude-opus-4-8", label: "claude opus 4.8", harnesses: CLAUDE },
  { id: "claude-sonnet-4-6", label: "claude sonnet 4.6", harnesses: CLAUDE },
  { id: "claude-haiku-4-5", label: "claude haiku 4.5", harnesses: CLAUDE },
  { id: "gpt-6", label: "gpt-6", harnesses: OPENAI },
  { id: "gpt-6-mini", label: "gpt-6 mini", harnesses: OPENAI },
  { id: "gpt-5-6", label: "gpt-5.6", harnesses: OPENAI },
  { id: "gpt-5.3-codex", label: "gpt-5.3-codex", harnesses: OPENAI },
  { id: "gemini-4-pro", label: "gemini 4 pro", harnesses: GEMINI },
  { id: "gemini-3-8-flash", label: "gemini 3.8 flash", harnesses: GEMINI },
  { id: "deepseek-v4-1", label: "deepseek v4.1", harnesses: ["opencode", "pi"] },
  { id: "kimi-k3", label: "kimi k3", harnesses: ["opencode", "pi"] },
  { id: "qwen-3-8-max", label: "qwen 3.8 max", harnesses: ["opencode", "pi"] },
];

export const DEFAULT_MODEL = "auto-genius";

export function modelLabel(id: string): string {
  if (!id) return "";
  if (id.startsWith("router:")) return `${id.slice(7)} (router)`;
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

/** Models a harness can run, plus model routers from the definition and the current value if unknown. */
export function modelsFor(harness: string, routers: string[] = [], current?: string): { id: string; label: string }[] {
  const list = MODELS.filter((m) => !harness || m.harnesses.includes(harness as HarnessId)).map(({ id, label }) => ({ id, label }));
  for (const r of routers) list.push({ id: `router:${r}`, label: `${r} (router)` });
  if (current && !list.some((m) => m.id === current)) list.push({ id: current, label: modelLabel(current) });
  return list;
}

export type HostOption = { id: string; label: string; kind: "local" | "docker" | "kubernetes" | "worker" };

export const BUILTIN_HOSTS: HostOption[] = [
  { id: "docker", label: "Docker", kind: "docker" },
  { id: "kubernetes", label: "Kubernetes", kind: "kubernetes" },
  { id: "local", label: "Local", kind: "local" },
];

export function hostOptions(workers: { id: string; name?: string }[]): HostOption[] {
  return [...BUILTIN_HOSTS, ...workers.map((w) => ({ id: `worker:${w.id}`, label: w.name ?? w.id, kind: "worker" as const }))];
}

/** Agent types, their labels and their org-chart order. */
export const AGENT_TYPES = ["FOREMAN", "TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "VERIFY", "PLAN", "PO_ASSISTANT", "CUSTOM"] as const;

export const AGENT_TYPE_LABEL: Record<string, string> = {
  FOREMAN: "Foreman",
  TRIAGE: "Triage",
  SPEC: "Spec",
  IMPLEMENT: "Code",
  REVIEW: "Review",
  VERIFY: "Verify",
  PLAN: "Plan",
  PO_ASSISTANT: "PO assistant",
  CUSTOM: "Custom",
};

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "Kiln Implement Agent" for built-in agents, "Mobile Build" for custom ones. */
export function agentDisplayName(factoryName: string, agent: { name: string; agentType: string }): string {
  if (agent.agentType === "CUSTOM") return titleCase(agent.name);
  return `${factoryName} ${titleCase(agent.name)} Agent`;
}

/** Default prompt bodies for agents created from the New menu. */
export const AGENT_TEMPLATES: Record<string, { name: string; description: string; prompt: string }> = {
  TRIAGE: { name: "triage", description: "Triages requests and establishes task state.", prompt: "# Triage\n\nYou are the triage agent of the software factory. Research the request, reproduce bugs only when research cannot find the cause, find or create the tracking issue and report its size (XS–XL).\n" },
  SPEC: { name: "spec", description: "Writes and drives approval of specifications.", prompt: "# Spec\n\nYou are the spec agent of the software factory. Interview the user through the foreman, then write a spec with Summary, Product behavior, Technical design, Decisions, Assumptions, Out of scope and Validation criteria.\n" },
  IMPLEMENT: { name: "implement", description: "Implements, validates, and updates code changes.", prompt: "# Implementation\n\nYou are the implementation agent of the software factory. Make the minimal correct change, prove it with tests, run the repo's checks and attach evidence to the pull request. Never merge.\n" },
  REVIEW: { name: "review", description: "Reviews factory pull requests and routes findings to rework or human resolution.", prompt: "# Review\n\nYou are the code review agent of the software factory. Review adversarially against the issue and spec. Report findings with location, severity, problem, impact and correction to the foreman; never post on the PR yourself.\n" },
  CUSTOM: { name: "", description: "", prompt: "" },
};
