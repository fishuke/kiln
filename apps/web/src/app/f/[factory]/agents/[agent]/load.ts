import "server-only";
import { parse } from "yaml";
import { agentDisplayName } from "@/lib/agent-catalog";
import { filesApiAvailable, listBuiltinMcps, listMcpServers, listSecrets, listWorkers } from "@/lib/api/factory-admin";
import { api, safe } from "@/lib/kiln";
import type { RunnerFile } from "@/components/kiln/runner-dialog";
import type { AutomationRow } from "./agent-editor";

const TRIGGER_LABEL: Record<string, string> = { github: "GitHub", gitlab: "GitLab", linear: "Linear", jira: "Jira", slack: "Slack", schedule: "Schedule", webhook: "Webhook", factory: "Factory", kiln: "Kiln" };

/** Everything the agent editor needs besides the agent itself. */
export async function loadAgentContext(factory: string) {
  const [f, def, secrets, mcps, builtins, workers, filesApi] = await Promise.all([
    safe(() => api.factory(factory), null),
    safe(() => api.definition(factory), null),
    listSecrets(),
    listMcpServers(),
    listBuiltinMcps(),
    listWorkers(),
    filesApiAvailable(factory),
  ]);
  if (!f) return null;
  const d = f.definition as { agentDefaults?: { harness?: { type?: string; model?: string }; model?: string; runner?: string; workerHost?: string } };
  const tree = def?.tree ?? {};
  const runnerFiles: Record<string, RunnerFile> = {};
  for (const [path, src] of Object.entries(tree)) {
    const m = /^runners\/([^/]+)\.ya?ml$/.exec(path);
    if (m) runnerFiles[m[1]!] = (safeParse(src) ?? {}) as RunnerFile;
  }
  for (const [name, r] of Object.entries(f.runners)) runnerFiles[name] ??= r as RunnerFile;
  const defaultRunner = d.agentDefaults?.runner ?? (runnerFiles.default ? "default" : "");
  const backend = (runnerFiles[defaultRunner] as { backend?: string } | undefined)?.backend ?? "docker";
  const repo = f.factory.definitionRepo ? `${f.factory.definitionRepo.owner}/${f.factory.definitionRepo.name}` : undefined;
  return {
    f,
    tree,
    secrets: secrets.map((s) => ({ name: s.name, description: s.description, type: s.type })),
    mcps: [
      ...mcps.map((m) => ({ name: m.name, description: m.description, managed: m.mode === "managed" })),
      ...builtins.map((b) => ({ name: b.kiln_id, description: b.description, managed: true, builtin: true, missing: b.missing })),
    ],
    // Runs route to a worker id (`workerHost`); several instances can share one.
    workers: [...new Set(workers.map((w) => w.workerId))].map((id) => ({ id, name: id })),
    runners: Object.entries(runnerFiles).map(([name, r]) => ({ name, os: r.platform?.os ?? "linux", description: r.description })),
    runnerFiles,
    routers: Object.keys(f.routers),
    defaults: {
      harness: d.agentDefaults?.harness?.type ?? "",
      model: d.agentDefaults?.harness?.model ?? d.agentDefaults?.model ?? "",
      runner: defaultRunner,
      host: d.agentDefaults?.workerHost ?? backend,
    },
    repo,
    readOnly: !!repo && !filesApi,
  };
}

function safeParse(src: string): unknown {
  try {
    return parse(src);
  } catch {
    return null;
  }
}

export function automationsFor(f: NonNullable<Awaited<ReturnType<typeof loadAgentContext>>>["f"], agent: string, agentType: string): AutomationRow[] {
  return f.automations
    .filter((a) => a.agent === agent || (!a.agent && agentType === "FOREMAN"))
    .map((a) => ({
      name: a.name,
      title: (a as { displayName?: string }).displayName ?? a.name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      enabled: a.enabled,
      triggers: [...new Set(a.triggers.map((t) => (t.schedule ? `Every ${t.schedule.name ?? t.schedule.cron}` : `${TRIGGER_LABEL[t.provider] ?? t.provider} ${t.event.replace(/[._]/g, " ")}`)))].join(", "),
    }));
}

export function otherAgents(f: NonNullable<Awaited<ReturnType<typeof loadAgentContext>>>["f"], except?: string) {
  return f.agents.filter((a) => a.name !== except).map((a) => ({ name: a.name, title: a.agentType === "FOREMAN" ? `${f.factory.alias} Foreman` : agentDisplayName(f.factory.name, a) }));
}
