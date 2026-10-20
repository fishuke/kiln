import type { AgentType, Factory, Harness } from "@kiln/schema";
import type { z } from "zod";
import type { ParsedFactory } from "./parse";

type HarnessT = z.infer<typeof Harness>;

export type Execution = {
  harness: HarnessT;
  runner?: string;
  secrets: string[];
  mcpServers: string[];
};

export type ResolvedAgent = Execution & {
  name: string;
  agentType: AgentType;
  description?: string;
  instructions: string;
  skills: string[];
  spawnableBy: string[];
  idleTimeoutMinutes: number;
};

export type ResolvedAutomation = Execution & {
  name: string;
  agent: string;
  enabled: boolean;
  prompt: string;
  triggers: ParsedFactory["automations"][string]["frontmatter"]["triggers"];
};

export type ResolvedFactory = {
  sha: string;
  factory: Factory;
  agents: Record<string, ResolvedAgent>;
  automations: Record<string, ResolvedAutomation>;
  parsed: ParsedFactory;
};

type Layer = {
  harness?: HarnessT | null;
  model?: string | null;
  runner?: string | null;
  secrets?: string[] | null;
  mcpServers?: string[] | null;
};

type Partial = { harness?: HarnessT; model?: string; runner?: string; secrets?: string[]; mcpServers?: string[] };

/**
 * Apply one layer of execution settings over another.
 * A key set to null clears the inherited value. Setting `harness` replaces the inherited harness
 * and model; setting `model` keeps an inherited harness and overrides its model.
 */
export function applyLayer(base: Partial, layer: Layer): Partial {
  const next: Partial = { ...base };
  for (const key of ["runner", "secrets", "mcpServers"] as const) {
    if (layer[key] === null) delete next[key];
    else if (layer[key] !== undefined) (next as Record<string, unknown>)[key] = layer[key];
  }
  if (layer.harness === null) delete next.harness;
  else if (layer.harness !== undefined) {
    next.harness = { ...layer.harness };
    delete next.model;
  }
  if (layer.model === null) delete next.model;
  else if (layer.model !== undefined) {
    if (next.harness) next.harness = { ...next.harness, model: layer.model };
    else next.model = layer.model;
  }
  return next;
}

function toExecution(p: Partial): Execution {
  const harness: HarnessT = p.harness ?? { type: "claude-code" };
  if (!p.harness && p.model) harness.model = p.model;
  return { harness, runner: p.runner, secrets: p.secrets ?? [], mcpServers: p.mcpServers ?? [] };
}

export function resolve(parsed: ParsedFactory): ResolvedFactory {
  if (!parsed.factory) throw new Error("cannot resolve a tree without factory.yaml");
  const defaults = applyLayer({}, parsed.factory.agentDefaults);
  const sharedSkills = Object.keys(parsed.skills);
  const agents: Record<string, ResolvedAgent> = {};
  const layers: Record<string, Partial> = {};

  for (const [name, a] of Object.entries(parsed.agents)) {
    const merged = applyLayer(defaults, a.frontmatter);
    layers[name] = merged;
    agents[name] = {
      name,
      agentType: a.frontmatter.agentType,
      description: a.frontmatter.description,
      instructions: a.instructions,
      skills: [...sharedSkills, ...Object.keys(a.skills)],
      spawnableBy: a.frontmatter.spawnableBy ?? ["foreman"],
      idleTimeoutMinutes: a.frontmatter.idleTimeoutMinutes ?? 10,
      ...toExecution(merged),
    };
  }

  const foreman = Object.values(agents).find((a) => a.agentType === "FOREMAN")?.name ?? "foreman";
  const automations: Record<string, ResolvedAutomation> = {};
  for (const [name, au] of Object.entries(parsed.automations)) {
    const agent = au.frontmatter.agent ?? foreman;
    const merged = applyLayer(layers[agent] ?? defaults, au.frontmatter);
    automations[name] = {
      name,
      agent,
      enabled: au.frontmatter.enabled,
      prompt: au.prompt,
      triggers: au.frontmatter.triggers,
      ...toExecution(merged),
    };
  }

  return { sha: parsed.sha, factory: parsed.factory, agents, automations, parsed };
}
