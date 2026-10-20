import type { DefinitionTree } from "@kiln/definitions";
import { stringify } from "yaml";
import { AUTOMATION_TEMPLATES, automationFile, defaultAutomations } from "./defaults/automations";
import { DEFAULT_AGENT_DESCRIPTIONS, foremanPrompt, implementPrompt, learningPrompt, reviewPrompt, specPrompt, triagePrompt, type DefaultAgentRole } from "./defaults/prompts";
import { DEFAULT_SCORERS, scorerFile } from "./defaults/scorers";
import { CODE_REVIEW_SKILL, githubSkill, JIRA_SKILL, LINEAR_SKILL, SLACK_SKILL, UI_VERIFICATION_SKILL, type SkillDoc } from "./defaults/skills";
import { slug } from "./definitions";
import { frontmatterFile } from "./editing";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { C, type Attachment, type FactoryBinding, type Run } from "./types";

export type CostPreset = "quality" | "efficient";

export const PRESET_MODELS: Record<CostPreset, Record<DefaultAgentRole, string>> = {
  quality: { foreman: "claude-opus-5-5", triage: "claude-sonnet-5-5", spec: "claude-opus-5-5", implement: "claude-opus-5-5", review: "claude-sonnet-5-5" },
  efficient: { foreman: "claude-sonnet-5-5", triage: "claude-haiku-5-5", spec: "claude-sonnet-5-5", implement: "claude-sonnet-5-5", review: "claude-haiku-5-5" },
};

export const JUDGE_MODEL = "claude-haiku-5-5";

export type CreateFactoryInput = {
  name: string;
  alias?: string;
  description?: string;
  avatar?: Attachment;
  repos: { owner: string; name: string; forge?: "github" | "gitlab"; deferred?: boolean }[];
  agents?: Partial<Record<"triage" | "spec" | "implement" | "review", boolean>>;
  communications?: { slack?: boolean };
  tracker?: { type: "linear" | "jira"; scopes?: string[] };
  costPreset?: CostPreset;
  harness?: "claude-code" | "codex" | "opencode" | "gemini" | "pi";
  selfImprovement?: boolean;
  automationTemplates?: string[];
  runner?: { image?: string; setupCommands?: string[] };
  workerHost?: string;
  dryRun?: boolean;
};

const ROLE_TYPE: Record<DefaultAgentRole, string> = { foreman: "FOREMAN", triage: "TRIAGE", spec: "SPEC", implement: "IMPLEMENT", review: "REVIEW" };

/**
 * The factory creation wizard as one call: it writes the whole definition tree (agents with
 * default prompts, skills, scorers, automations, a runner), applies it as a Kiln-managed
 * factory, and can start a learning run that adapts the prompts to the team's repos and tools.
 */
export class FactoryWizard {
  constructor(private readonly k: Kiln) {}

  templates() {
    return AUTOMATION_TEMPLATES.map(({ id, title, description, role, needs }) => ({ id, title, description, role, needs }));
  }

  /** The tree the wizard would create, without applying it. */
  tree(input: CreateFactoryInput): { tree: DefinitionTree; alias: string; id: string } {
    if (!input.repos.length) throw new KilnError("invalid_request", "pick at least one repository");
    const alias = input.alias ?? slug(input.name).slice(0, 60);
    const id = slug(alias);
    if (!id) throw new KilnError("invalid_request", "the alias needs at least one letter or digit");
    const preset = PRESET_MODELS[input.costPreset ?? "quality"];
    const harness = input.harness ?? "claude-code";
    const toggles = { triage: true, spec: true, implement: true, review: true, ...input.agents };
    const roles: DefaultAgentRole[] = ["foreman", ...(["triage", "spec", "implement", "review"] as const).filter((r) => toggles[r])];
    const tracker = input.tracker?.type;
    const slack = Boolean(input.communications?.slack);
    const github = input.repos.some((r) => (r.forge ?? "github") === "github");
    const integrations = [...new Set([github ? "github" : "gitlab", ...(slack ? ["slack"] : []), ...(tracker ? [tracker] : [])])];

    const tree: DefinitionTree = {};
    tree["factory.yaml"] = stringify({
      schemaVersion: "kiln/v1",
      name: input.name,
      alias,
      ...(input.description ? { description: input.description } : {}),
      repositories: input.repos.map((r) => ({ ...(r.forge && r.forge !== "github" ? { forge: r.forge } : {}), owner: r.owner, name: r.name, ...(r.deferred ? { deferred: true } : {}) })),
      integrations,
      agentDefaults: { harness: { type: harness, model: preset.implement }, runner: "default", ...(input.workerHost ? { workerHost: input.workerHost } : {}) },
      scoring: { defaultModel: JUDGE_MODEL },
      selfImprovement: { enabled: input.selfImprovement ?? true, failedRunThreshold: 25, reviewers: { type: "admins" } },
    });
    tree["runners/default.yaml"] = stringify({
      description: "Default Linux runner for every agent",
      image: input.runner?.image ?? "node:22-bookworm",
      setupCommands: input.runner?.setupCommands ?? [],
    });

    const prompts: Record<DefaultAgentRole, string> = {
      foreman: foremanPrompt({ alias, tracker, chat: slack, agents: roles }),
      triage: triagePrompt({ tracker }),
      spec: specPrompt(),
      implement: implementPrompt(),
      review: reviewPrompt(),
    };
    for (const role of roles) {
      const front: Record<string, unknown> = { description: DEFAULT_AGENT_DESCRIPTIONS[role], agentType: ROLE_TYPE[role] };
      if (preset[role] !== preset.implement) front.model = preset[role];
      if (role !== "foreman") front.spawnableBy = ["foreman"];
      tree[`agents/${role}/agent.md`] = frontmatterFile(front, prompts[role]);
    }

    const skills: SkillDoc[] = [githubSkill(alias), CODE_REVIEW_SKILL, UI_VERIFICATION_SKILL, ...(slack ? [SLACK_SKILL] : []), ...(tracker === "linear" ? [LINEAR_SKILL] : tracker === "jira" ? [JIRA_SKILL] : [])];
    for (const s of skills) tree[`skills/${s.name}/SKILL.md`] = frontmatterFile({ name: s.name, description: s.description, owner: "kiln", version: "1" }, s.body);

    for (const doc of DEFAULT_SCORERS) {
      const agents = doc.roles === "all" ? roles : doc.roles.filter((r) => roles.includes(r as DefaultAgentRole));
      tree[`scorers/${doc.slug}/scorer.md`] = scorerFile(doc, agents.length ? agents : ["foreman"], JUDGE_MODEL);
    }

    for (const [name, a] of Object.entries(defaultAutomations({ alias, github, slack, tracker, trackerScopes: input.tracker?.scopes }))) {
      tree[`automations/${name}/automation.md`] = automationFile({ triggers: a.triggers }, a.prompt);
    }
    for (const tid of input.automationTemplates ?? []) {
      const t = AUTOMATION_TEMPLATES.find((x) => x.id === tid);
      if (!t) throw new KilnError("invalid_request", `unknown automation template ${tid}`);
      if (t.needs === "linear" && tracker !== "linear") throw new KilnError("integration_not_configured", `${t.title} needs Linear`, { integrationName: "linear" });
      if (t.needs === "jira" && tracker !== "jira") throw new KilnError("integration_not_configured", `${t.title} needs Jira`, { integrationName: "jira" });
      const agent = roles.includes(t.role) ? t.role : "foreman";
      tree[`automations/${t.id}/automation.md`] = automationFile({ ...(agent !== "foreman" ? { agent } : {}), displayName: t.title, triggers: t.triggers }, t.prompt);
    }
    return { tree, alias, id };
  }

  async create(input: CreateFactoryInput, by: string) {
    const { tree, alias, id } = this.tree(input);
    this.k.editor.checkAlias(alias);
    if (this.k.defs.get(id)) throw new KilnError("conflict", `a factory with the id ${id} already exists`);
    const r = this.k.defs.apply(tree, { author: by, factory: id, dryRun: input.dryRun });
    if (!r.ok) throw new KilnError("invalid_request", `the generated definition is invalid:\n${r.errors.join("\n")}`, { errors: r.errors });
    if (input.dryRun) return { factory: undefined, sha: r.sha, files: Object.keys(tree).sort(), tree, dryRun: true };
    const b = this.k.defs.require(id);
    this.k.store.put<FactoryBinding>(C.factories, { ...b, creator: by });
    if (input.avatar) await this.k.editor.setAvatar(id, input.avatar, by);
    this.k.audit(by, "factory.created", id, { files: Object.keys(tree).length });
    return { factory: this.k.defs.require(id), sha: r.sha, files: Object.keys(tree).sort(), dryRun: false };
  }

  /**
   * "Enable learning": a run of the foreman that studies the repos and tools and proposes
   * memories and prompt changes. Memories land as proposals; prompt changes as definition changes.
   */
  async enableLearning(factory: string, by: string): Promise<Run> {
    const resolved = this.k.defs.current(factory);
    const foreman = Object.values(resolved.agents).find((a) => a.agentType === "FOREMAN");
    if (!foreman) throw new KilnError("resource_not_found", `${factory} has no foreman`);
    const prompt = learningPrompt({
      alias: resolved.factory.alias ?? factory,
      repos: resolved.factory.repositories.map((r) => `${r.owner}/${r.name}`),
      tools: resolved.factory.integrations,
    });
    const handle = (run: Run) => {
      for (const m of (run.result?.memories as { title: string; body: string; tags?: string[] }[] | undefined) ?? []) this.k.memories.propose(factory, { ...m, author: `agent:${foreman.name}`, sourceRunId: run.id });
      const change = run.result?.definitionChange as { title?: string; message?: string; files?: Record<string, string | null> } | undefined;
      if (change?.files && Object.keys(change.files).length) {
        try {
          this.k.definitionChanges.propose({ factory, title: change.title ?? "Adapt prompts to this team", message: change.message ?? run.summary ?? "", files: change.files, by: `agent:${foreman.name}`, runId: run.id });
        } catch (err) {
          this.k.audit("learning", "definition_change.invalid", factory, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    };
    return new Promise<Run>((resolve, reject) => {
      this.k.runs
        .execute({ factory, sha: resolved.sha, agent: foreman.name, prompt, kind: "work", push: false, source: "WEB_APP", title: "Learn this factory's setup", creator: by, metadata: { purpose: "learning" }, onCreated: (r) => resolve(structuredClone(r)) })
        .then(handle)
        .catch(reject);
    });
  }
}
