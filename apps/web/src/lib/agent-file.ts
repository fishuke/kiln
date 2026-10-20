import { parseFrontmatter, updateFrontmatter, writeFrontmatter } from "./frontmatter";

/** The editable shape of `agents/<name>/agent.md`. Empty strings and `null` mean "inherit from agentDefaults". */
export type AgentForm = {
  agentType: string;
  description: string;
  prompt: string;
  harness: string;
  /** Name of a Kiln secret passed to the harness (an API key or CLAUDE_CODE_OAUTH_TOKEN). */
  authSecret: string;
  model: string;
  /** "" (factory default), local, docker, kubernetes or a self-hosted worker id. */
  host: string;
  runner: string;
  secrets: string[] | null;
  mcpServers: string[] | null;
  /** null = foreman only (key omitted); [] = nobody. */
  spawnableBy: string[] | null;
  idleTimeoutMinutes: number | null;
  computerUse: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : null);

export function emptyAgentForm(agentType = "CUSTOM"): AgentForm {
  return { agentType, description: "", prompt: "", harness: "", authSecret: "", model: "", host: "", runner: "", secrets: null, mcpServers: null, spawnableBy: null, idleTimeoutMinutes: null, computerUse: true };
}

export function agentFormFromSource(source: string): AgentForm {
  const { data, body } = parseFrontmatter(source);
  const harness = data.harness && typeof data.harness === "object" ? (data.harness as Record<string, unknown>) : undefined;
  const auth = harness?.auth && typeof harness.auth === "object" ? (harness.auth as Record<string, unknown>) : undefined;
  return {
    agentType: str(data.agentType) || "CUSTOM",
    description: str(data.description),
    prompt: body.replace(/\s+$/, ""),
    harness: str(harness?.type),
    authSecret: str(auth?.secretName),
    model: str(harness?.model) || str(data.model),
    host: str(data.workerHost),
    runner: str(data.runner),
    secrets: list(data.secrets),
    mcpServers: list(data.mcpServers),
    spawnableBy: list(data.spawnableBy),
    idleTimeoutMinutes: typeof data.idleTimeoutMinutes === "number" ? data.idleTimeoutMinutes : null,
    computerUse: data.computerUse !== false,
  };
}

/** Frontmatter keys owned by the editor. Keys it does not know (skills, required_repos, …) are kept. */
export function agentPatch(form: AgentForm): Record<string, unknown> {
  const harness = form.harness
    ? {
        type: form.harness,
        ...(form.model ? { model: form.model } : {}),
        ...(form.authSecret ? { auth: { source: "secret", secretName: form.authSecret } } : {}),
      }
    : undefined;
  return {
    description: form.description.trim() || undefined,
    agentType: form.agentType,
    harness,
    model: harness ? undefined : form.model || undefined,
    workerHost: form.host || undefined,
    runner: form.runner || undefined,
    secrets: form.secrets ?? undefined,
    mcpServers: form.mcpServers ?? undefined,
    spawnableBy: form.spawnableBy ?? undefined,
    idleTimeoutMinutes: form.idleTimeoutMinutes ?? undefined,
    computerUse: form.computerUse ? undefined : false,
  };
}

/** Writes the form back into an existing file (keeping unknown keys and comments) or creates a new one. */
export function agentSourceFromForm(form: AgentForm, existing?: string): string {
  const body = form.prompt.endsWith("\n") ? form.prompt : `${form.prompt}\n`;
  const patch = agentPatch(form);
  if (existing) return updateFrontmatter(existing, patch, body);
  const ordered = { agentType: patch.agentType, description: patch.description, ...patch };
  return writeFrontmatter(ordered, body);
}

/** Directory names are agent identities: lowercase letters, digits and dashes. */
export function agentSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const agentPath = (name: string) => `agents/${name}/agent.md`;
