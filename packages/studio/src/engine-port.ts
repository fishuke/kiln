import type { HarnessType } from "@kiln/schema";
import type { AppRunDefinition, RunRef, Studio, StudioRuns } from "./studio";

/** The engine's RunService as Studio uses it (structural: Studio doesn't import the engine). */
export type RunServiceLike = {
  startInBackground(input: {
    factory: string;
    app: string;
    sha: string;
    agent: string;
    prompt: string;
    push: boolean;
    source: "WEB_APP" | "MCP" | "API";
    creator: string;
    metadata: Record<string, string>;
    overrides?: { harness?: HarnessType; model?: string };
  }): Promise<{ id: string }>;
  followup(runId: string, input: { message: string; by: string }): Promise<{ delivered: "steered" | "continued"; run: { id: string } }>;
  interrupt(runId: string, by: string): Promise<void>;
  isActive(runId: string): boolean;
};

/** Studio's runs port over the engine's RunService: an App run is `factory: "app:<id>"` with `app` set. */
export function studioRuns(runs: RunServiceLike): StudioRuns {
  return {
    start: async (i) => {
      const run = await runs.startInBackground({
        factory: `app:${i.appId}`,
        app: i.appId,
        // App definitions resolve by App, not by a stored factory sha.
        sha: "",
        agent: i.agent,
        prompt: i.prompt,
        push: false,
        source: i.via === "mcp" ? "MCP" : i.via === "web" ? "WEB_APP" : "API",
        creator: i.by,
        metadata: { "studio.chat": i.chatId },
        ...(i.harness || i.model ? { overrides: { ...(i.harness ? { harness: i.harness } : {}), ...(i.model ? { model: i.model } : {}) } } : {}),
      });
      return { runId: run.id };
    },
    followup: async (runId, input) => {
      const r = await runs.followup(runId, input);
      return { delivered: r.delivered, runId: r.run.id };
    },
    interrupt: (runId, by) => runs.interrupt(runId, by),
    active: (runId) => runs.isActive(runId),
  };
}

/** The engine's hooks for App runs (KilnOptions.apps and .workspaces), answered by the Studio that `studio()` returns. */
export function studioEngineHooks(studio: () => Studio | undefined): {
  apps: { definition(appId: string): AppRunDefinition };
  workspaces: { acquire(run: RunRef, parent?: RunRef): Promise<Awaited<ReturnType<Studio["acquire"]>>>; release(run: RunRef): Promise<void> };
} {
  const require = () => {
    const s = studio();
    if (!s) throw new Error("this server runs no Studio (KILN_STUDIO=1)");
    return s;
  };
  return {
    apps: { definition: (appId) => require().definition(appId) },
    workspaces: {
      // Factory runs (no app) keep their own sandboxes.
      acquire: async (run, parent) => (run.app ? require().acquire(run, parent) : undefined),
      release: async (run) => {
        if (run.app) await require().release(run);
      },
    },
  };
}
