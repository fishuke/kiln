import type { ResolvedAgent, ResolvedAutomation, ResolvedFactory } from "@kiln/definitions";
import { cloudProviderEnv } from "./cloud";

/**
 * What a run reads from its definition. A factory's run reads its resolved factory tree; a Studio
 * App's run reads the App's definition through `KilnOptions.apps` (ADR-012). Factory-only parts
 * (routers, runners, repositories, automations, decisions, cloud providers) are empty for an App.
 */
export type RunDefinition = {
  sha: string;
  agents: Record<string, ResolvedAgent>;
  automations: Record<string, ResolvedAutomation>;
  routers: ResolvedFactory["parsed"]["routers"];
  decisions: ResolvedFactory["parsed"]["decisions"];
  runners: ResolvedFactory["parsed"]["runners"];
  repositories: ResolvedFactory["factory"]["repositories"];
  /** The agent's own `idleTimeoutMinutes`, when its file sets one. */
  explicitIdleMinutes(agent: string): number | undefined;
  /** A skill's text for an agent: its own skill of that name, else the shared one. */
  skill(agent: string, name: string): { body: string; description?: string } | undefined;
  cloudEnv: Record<string, string>;
};

export function factoryRunDefinition(r: ResolvedFactory): RunDefinition {
  return {
    sha: r.sha,
    agents: r.agents,
    automations: r.automations,
    routers: r.parsed.routers,
    decisions: r.parsed.decisions,
    runners: r.parsed.runners,
    repositories: r.factory.repositories,
    explicitIdleMinutes: (agent) => r.parsed.agents[agent]?.frontmatter.idleTimeoutMinutes ?? undefined,
    skill: (agent, name) => {
      const s = r.parsed.skills[name] ?? r.parsed.agents[agent]?.skills[name];
      return s ? { body: s.body, ...(s.frontmatter.description ? { description: s.frontmatter.description } : {}) } : undefined;
    },
    cloudEnv: cloudProviderEnv(r.factory),
  };
}

/** A Studio App's definition for its runs, resolved team → Kiln Project → App by the host. */
export type AppRunDefinition = {
  sha: string;
  team: string;
  /** The App's agents; their instructions already carry the App's mandatory skills. */
  agents: Record<string, ResolvedAgent>;
  skill(agent: string, name: string): { body: string; description?: string } | undefined;
  monthlyUsd?: number;
  /** Values people assigned to the App (team → Kiln Project → App), and which are secret. */
  env: Record<string, string>;
  secretValues: string[];
};

/** Studio gives the engine its Apps' definitions; the engine never imports Studio. */
export interface AppRunHost {
  definition(appId: string): AppRunDefinition;
}

export function appRunDefinition(a: AppRunDefinition): RunDefinition {
  return {
    sha: a.sha,
    agents: a.agents,
    automations: {},
    routers: {},
    decisions: {},
    runners: {},
    repositories: [],
    explicitIdleMinutes: () => undefined,
    skill: a.skill,
    cloudEnv: {},
  };
}
