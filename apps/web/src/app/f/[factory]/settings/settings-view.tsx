"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Cloud, ExternalLink, KeyRound, Pencil, Plug, Plus, RefreshCw, Server, Settings2, Trash, Upload, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { AzureDevOpsIcon, BitbucketIcon, DiscordIcon, GitHubIcon, GitLabIcon, JiraIcon, LinearIcon, SlackIcon, TeamsIcon } from "@/components/kiln/brand-icons";
import { InfoTip } from "@/components/kiln/info-tip";
import { McpTestButton } from "@/components/kiln/mcp-test";
import { AddMcpDialog, AddSecretDialog, AuthSecretField, Chips, DefaultBadge, FormRow, HarnessSelect, HostSelect, ModelSelect, RunnerSelect, type McpOption, type RunnerOption, type SecretOption, type WorkerOption } from "@/components/kiln/resource-pickers";
import { RunnerDialog, type RunnerFile } from "@/components/kiln/runner-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Connection } from "@/lib/api/factory-admin";
import { DEFAULT_MODEL } from "@/lib/agent-catalog";
import { validateAlias } from "@/lib/alias";
import { cn } from "@/lib/utils";
import { canaryAction, deleteRunner, loadConnectionOptions, migrateToGithub, removeFactory, saveFactoryYaml, syncNow, uploadFile } from "./actions";

type Repo = { forge?: string; owner: string; name: string; deferred?: boolean };
type ExecShape = { harness?: { type?: string; model?: string; auth?: { source: string; secretName?: string } } | null; model?: string | null; runner?: string | null; workerHost?: string | null; secrets?: string[] | null; mcpServers?: string[] | null };
type IntegrationEntry = string | ({ type: string } & Record<string, unknown>);
export type FactoryYaml = {
  name?: string;
  alias?: string;
  description?: string;
  avatar?: string;
  repositories?: Repo[];
  credentialStrategy?: "EXECUTOR" | "CREATOR";
  integrations?: IntegrationEntry[];
  cloudProviders?: { aws?: { roleArn: string }; gcp?: { projectNumber: string; workloadIdentityFederationPoolId: string; workloadIdentityFederationProviderId: string; serviceAccountEmail?: string } };
  agentDefaults?: ExecShape;
  scorerDefaults?: { runner?: string; secrets?: string[]; mcpServers?: string[] };
  scoring?: { defaultModel?: string };
  selfImprovement?: { model?: string; failedRunThreshold?: number; reviewers?: { type?: string; emails?: string[] }; scorers?: string[] };
};

type Binding = { name: string; alias: string; createdAt: string; createdBy?: string; repo?: { owner: string; name: string; ref: string; dir: string }; canary?: { sha: string; percent: number; since: string }; appliedSha?: string };

type Props = {
  factory: string;
  binding: Binding;
  yaml: FactoryYaml;
  takenAliases: string[];
  connections: Connection[];
  secrets: SecretOption[];
  mcps: McpOption[];
  workers: WorkerOption[];
  runners: RunnerOption[];
  runnerFiles: Record<string, RunnerFile>;
  routers: string[];
  defaults: { harness: string; model: string; runner: string; host: string };
  scorers: { slug: string; name: string }[];
  readOnly: boolean;
  memories?: React.ReactNode;
};

/* ---------- shared bits ---------- */

function Card({ id, title, action, children, className }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="text-lg font-medium text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className={cn("rounded-xl border bg-muted p-6 dark:bg-muted/30", className)}>{children}</div>
    </section>
  );
}

function Field({ title, hint, meta, children }: { title: string; hint?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold">{title}</div>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function useSave(factory: string) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (patch: Record<string, unknown>, message: string, after?: () => void) =>
    start(async () => {
      const r = await saveFactoryYaml(factory, patch, message);
      if (!r.ok) {
        toast.error(r.error, { description: r.errors?.slice(1, 4).join("\n") });
        return;
      }
      if (r.pullRequest) toast.success("Pull request opened", { description: r.pullRequest, action: { label: "View", onClick: () => window.open(r.pullRequest, "_blank") } });
      else toast.success("Settings saved");
      after?.();
      router.refresh();
    });
  return [pending, save] as const;
}

function SaveBar({ dirty, pending, onSave, onReset, readOnly }: { dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void; readOnly: boolean }) {
  if (!dirty || readOnly) return null;
  return (
    <div className="mt-6 flex items-center justify-end gap-2 border-t pt-4">
      <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
      <Button variant="ghost" onClick={onReset} disabled={pending}>
        Discard
      </Button>
      <Button onClick={onSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const FORGE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { github: GitHubIcon, gitlab: GitLabIcon, azure_devops: AzureDevOpsIcon, bitbucket: BitbucketIcon };

/* ---------- General info ---------- */

function GeneralInfo({ factory, binding, yaml, takenAliases, connections, readOnly }: Pick<Props, "factory" | "binding" | "yaml" | "takenAliases" | "connections" | "readOnly">) {
  const initial = useMemo(
    () => ({
      name: yaml.name ?? binding.name,
      alias: yaml.alias ?? binding.alias,
      description: yaml.description ?? "",
      avatar: yaml.avatar ?? "",
      repositories: (yaml.repositories ?? []).map((r) => ({ forge: r.forge ?? "github", owner: r.owner, name: r.name, deferred: !!r.deferred })),
      credentialStrategy: yaml.credentialStrategy ?? "EXECUTOR",
    }),
    [yaml, binding],
  );
  const [s, setS] = useState(initial);
  const [pending, save] = useSave(factory);
  const [repoQuery, setRepoQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [loadingRepos, startRepos] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const aliasError = validateAlias(s.alias, takenAliases, binding.alias);
  const forgeConn = connections.find((c) => ["github", "gitlab", "azure_devops", "bitbucket"].includes(c.provider));
  const refreshRepos = () =>
    startRepos(async () => {
      if (!forgeConn) return;
      setSuggestions(await loadConnectionOptions(forgeConn.id, "repositories"));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshRepos, [forgeConn?.id]);
  const addRepo = (full: string) => {
    const [owner, name] = full.trim().replace(/^https?:\/\/[^/]+\//, "").split("/");
    if (!owner || !name) return void toast.error("Use owner/name, e.g. acme/web.");
    if (s.repositories.some((r) => r.owner === owner && r.name === name)) return;
    setS({ ...s, repositories: [...s.repositories, { forge: forgeConn?.provider ?? "github", owner, name, deferred: false }] });
    setRepoQuery("");
  };
  const matches = suggestions.filter((r) => r.name.toLowerCase().includes(repoQuery.toLowerCase()) && !s.repositories.some((x) => `${x.owner}/${x.name}` === r.name)).slice(0, 8);
  const created = new Date(binding.createdAt);
  const avatarUrl = s.avatar ? `/files/${s.avatar}` : null;

  return (
    <Card id="general-info" title="General info">
      <fieldset disabled={readOnly} className="space-y-6">
        <Field title="Factory name" meta={`Created${binding.createdBy ? ` by ${binding.createdBy}` : ""} on ${created.toLocaleDateString("en-US")}`} hint="This is the name that you will see in Kiln.">
          <Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} className="h-10 bg-background" aria-label="Factory name" maxLength={100} />
        </Field>
        <Field title="Foreman name" hint="This is the name you will use to @-mention your factory foreman in other integrated platforms. It also names the factory:<alias> label.">
          <div className="relative">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">@</span>
            <Input value={s.alias} onChange={(e) => setS({ ...s, alias: e.target.value.toLowerCase().replace(/^@/, "") })} className="h-10 bg-background pl-7" aria-label="Foreman name" aria-invalid={!!aliasError} maxLength={60} />
          </div>
          {aliasError ? <p className="text-xs text-red-600 dark:text-red-400">{aliasError}</p> : s.alias !== binding.alias ? <p className="text-xs text-muted-foreground">Old factory:{binding.alias} labels stay on existing issues and PRs; delete them on the forge if you no longer need them.</p> : null}
        </Field>
        <Field title="Description" hint="What this factory works on. Agents see it in their context.">
          <Textarea value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} className="bg-background" aria-label="Description" rows={2} />
        </Field>
        <Field title="Add an avatar (optional)" hint="We'll use this avatar for your factory list in Kiln as well as other integrated platforms.">
          <div className="flex items-center gap-3">
            <div className="relative">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="size-10 rounded-md object-cover" />
              ) : (
                <span className="flex size-10 items-center justify-center rounded-md bg-emerald-950 text-lg font-semibold text-emerald-50 dark:bg-emerald-800">{(s.name || "K").charAt(0).toUpperCase()}</span>
              )}
              {s.avatar && (
                <button type="button" aria-label="Remove avatar" onClick={() => setS({ ...s, avatar: "" })} className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append("file", file);
                startUpload(async () => {
                  const r = await uploadFile(fd);
                  if (r.ok) setS((x) => ({ ...x, avatar: r.key }));
                  else toast.error(r.error);
                });
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload /> {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </Field>
        <Field title="Repos" hint="These are the repos connected to your factory. Deferred repos are prepared only when a run needs them.">
          <div className="space-y-2">
            {s.repositories.map((r, i) => {
              const Icon = FORGE_ICON[r.forge] ?? GitHubIcon;
              return (
                <div key={`${r.owner}/${r.name}`} className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                  <Icon className="size-4" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {r.owner}/{r.name}
                  </span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Deferred
                    <Switch size="sm" checked={r.deferred} onCheckedChange={(c) => setS({ ...s, repositories: s.repositories.map((x, j) => (j === i ? { ...x, deferred: c } : x)) })} aria-label={`Defer ${r.owner}/${r.name}`} />
                  </label>
                  <button type="button" aria-label={`Remove ${r.owner}/${r.name}`} onClick={() => setS({ ...s, repositories: s.repositories.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
            <div className="flex">
              <Popover open={!!repoQuery && matches.length > 0}>
                <PopoverTrigger render={<div className="relative flex-1" />}>
                  <Input
                    value={repoQuery}
                    onChange={(e) => setRepoQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRepo(repoQuery);
                      }
                    }}
                    placeholder="Search repos or type owner/name"
                    className="h-10 rounded-r-none bg-background"
                    aria-label="Search repos"
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-(--anchor-width) p-1" initialFocus={false}>
                  {matches.map((m) => (
                    <button key={m.id} type="button" onClick={() => addRepo(m.name)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                      <GitHubIcon className="size-4" /> {m.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <Button variant="outline" className="h-10 rounded-l-none border-l-0" aria-label="Refresh repositories" onClick={refreshRepos} disabled={loadingRepos || !forgeConn}>
                <RefreshCw className={cn(loadingRepos && "animate-spin")} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Missing a repo?{" "}
              <Link href="/integrations" className="font-medium text-foreground hover:underline">
                Configure access on your code host
              </Link>
            </p>
          </div>
        </Field>
        <Field title="Pull request author" hint="Determine who you'd like to author your factory created pull requests.">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
            {(
              [
                ["EXECUTOR", "Agent", "PRs are authored by the agent that created them."],
                ["CREATOR", "Run creator", "PRs are authored by the human that created the run (needs their linked code host account)."],
              ] as const
            ).map(([v, t, d]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={s.credentialStrategy === v}
                onClick={() => setS({ ...s, credentialStrategy: v })}
                className={cn("rounded-lg border bg-background p-3 text-left transition-colors", s.credentialStrategy === v ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/50")}
              >
                <span className={cn("mb-2 flex size-4 items-center justify-center rounded-full border", s.credentialStrategy === v && "border-foreground")}>{s.credentialStrategy === v && <span className="size-2 rounded-full bg-foreground" />}</span>
                <span className="block text-sm font-medium">{t}</span>
                <span className="block text-xs text-muted-foreground">{d}</span>
              </button>
            ))}
          </div>
        </Field>
      </fieldset>
      <SaveBar
        dirty={!same(s, initial)}
        pending={pending}
        readOnly={readOnly}
        onReset={() => setS(initial)}
        onSave={() => {
          if (aliasError) return void toast.error(aliasError);
          if (!s.name.trim()) return void toast.error("Enter a factory name.");
          if (!s.repositories.length) return void toast.error("Keep at least one repository.");
          save(
            {
              name: s.name.trim(),
              alias: s.alias,
              description: s.description.trim() || undefined,
              avatar: s.avatar || undefined,
              repositories: s.repositories.map((r) => ({ ...(r.forge !== "github" ? { forge: r.forge } : {}), owner: r.owner, name: r.name, ...(r.deferred ? { deferred: true } : {}) })),
              credentialStrategy: s.credentialStrategy === "CREATOR" ? "CREATOR" : undefined,
            },
            "Update general settings",
          );
        }}
      />
    </Card>
  );
}

/* ---------- Agent defaults, scorer defaults, benchmarking, self-improvement ---------- */

function ResourceList({ value, onChange, kind, secrets, mcps, factory }: { value: string[]; onChange: (v: string[]) => void; kind: "secret" | "mcp"; secrets: SecretOption[]; mcps: McpOption[]; factory?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chips items={value} icon={kind === "secret" ? KeyRound : Plug} empty="" onRemove={(n) => onChange(value.filter((x) => x !== n))} />
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Plus /> {kind === "secret" ? "Add secret" : "Add MCP"}
      </Button>
      {kind === "mcp" && factory && value.length > 0 && <McpTestButton scope={{ factory, servers: value }} title="Test MCP servers" />}
      {kind === "secret" ? (
        <AddSecretDialog open={open} onOpenChange={setOpen} secrets={secrets} selected={value} onAdd={(n) => onChange([...new Set([...value, ...n])])} />
      ) : (
        <AddMcpDialog open={open} onOpenChange={setOpen} servers={mcps} selected={value} onAdd={(n) => onChange([...new Set([...value, ...n])])} />
      )}
    </div>
  );
}

function AgentDefaults({ factory, yaml, secrets, mcps, workers, runners, runnerFiles, routers, readOnly, onRunner }: Pick<Props, "factory" | "yaml" | "secrets" | "mcps" | "workers" | "runners" | "runnerFiles" | "routers" | "readOnly"> & { onRunner: (name?: string) => void }) {
  const initial = useMemo(() => {
    const d = yaml.agentDefaults ?? {};
    return {
      harness: d.harness?.type ?? "",
      authSecret: d.harness?.auth?.secretName ?? "",
      model: d.harness?.model ?? d.model ?? "",
      host: d.workerHost ?? "",
      runner: d.runner ?? "",
      secrets: d.secrets ?? [],
      mcpServers: d.mcpServers ?? [],
    };
  }, [yaml.agentDefaults]);
  const [s, setS] = useState(initial);
  const [pending, save] = useSave(factory);
  const backend = (runnerFiles[s.runner] as { backend?: string } | undefined)?.backend ?? "docker";
  return (
    <Card id="agent-defaults" title="Agent defaults">
      <fieldset disabled={readOnly} className="space-y-4">
        <FormRow label="Harness" tip="The agent framework agents use unless they set their own." labelWidth="sm:grid-cols-[200px_1fr]">
          <HarnessSelect value={s.harness || "claude-code"} onChange={(v) => setS({ ...s, harness: v })} disabled={readOnly} />
        </FormRow>
        {s.harness && (
          <FormRow label="Auth" tip="The team secret the harness authenticates with: an API key, or a Claude subscription token (CLAUDE_CODE_OAUTH_TOKEN)." labelWidth="sm:grid-cols-[200px_1fr]">
            <AuthSecretField harness={s.harness} value={s.authSecret} onChange={(v) => setS({ ...s, authSecret: v })} secrets={secrets} disabled={readOnly} />
          </FormRow>
        )}
        <FormRow label="Default model" tip="The default model for custom agents. The available options depend on the selected harness." labelWidth="sm:grid-cols-[200px_1fr]">
          <ModelSelect value={s.model || DEFAULT_MODEL} onChange={(v) => setS({ ...s, model: v })} harness={s.harness || "claude-code"} routers={routers} defaultModel={DEFAULT_MODEL} disabled={readOnly} />
        </FormRow>
        <FormRow label="Host" tip="Where runs execute: on this Kiln server (Local), in Docker or Kubernetes, or on one of your own self-hosted workers." labelWidth="sm:grid-cols-[200px_1fr]">
          <HostSelect value={s.host} onChange={(v) => setS({ ...s, host: v })} workers={workers} defaultHost={backend} disabled={readOnly} />
        </FormRow>
        <FormRow label="Runner" tip="The runner agents use unless they set their own. The default runner must be Linux." labelWidth="sm:grid-cols-[200px_1fr]">
          <RunnerSelect value={s.runner} onChange={(v) => setS({ ...s, runner: v })} runners={runners} defaultRunner={initial.runner} onEdit={(n) => onRunner(n)} onNew={() => onRunner()} disabled={readOnly} />
        </FormRow>
        <FormRow label="Secrets" labelWidth="sm:grid-cols-[200px_1fr]">
          <ResourceList kind="secret" value={s.secrets} onChange={(v) => setS({ ...s, secrets: v })} secrets={secrets} mcps={mcps} />
        </FormRow>
        <FormRow label="MCPs" labelWidth="sm:grid-cols-[200px_1fr]">
          <ResourceList kind="mcp" value={s.mcpServers} onChange={(v) => setS({ ...s, mcpServers: v })} secrets={secrets} mcps={mcps} factory={factory} />
        </FormRow>
      </fieldset>
      <SaveBar
        dirty={!same(s, initial)}
        pending={pending}
        readOnly={readOnly}
        onReset={() => setS(initial)}
        onSave={() =>
          save(
            {
              "agentDefaults.harness": s.harness ? { type: s.harness, ...(s.model ? { model: s.model } : {}), ...(s.authSecret ? { auth: { source: "secret", secretName: s.authSecret } } : {}) } : undefined,
              "agentDefaults.model": s.harness ? undefined : s.model || undefined,
              "agentDefaults.workerHost": s.host || undefined,
              "agentDefaults.runner": s.runner || undefined,
              "agentDefaults.secrets": s.secrets.length ? s.secrets : undefined,
              "agentDefaults.mcpServers": s.mcpServers.length ? s.mcpServers : undefined,
            },
            "Update agent defaults",
          )
        }
      />
    </Card>
  );
}

function ScorerDefaults({ factory, yaml, secrets, mcps, runners, readOnly, onRunner }: Pick<Props, "factory" | "yaml" | "secrets" | "mcps" | "runners" | "readOnly"> & { onRunner: (name?: string) => void }) {
  const initial = useMemo(() => {
    const d = yaml.scorerDefaults ?? {};
    return { runner: d.runner ?? "", secrets: d.secrets ?? null, mcpServers: d.mcpServers ?? null };
  }, [yaml.scorerDefaults]);
  const [s, setS] = useState<{ runner: string; secrets: string[] | null; mcpServers: string[] | null }>(initial);
  const [pending, save] = useSave(factory);
  const inherited = <span className="text-xs text-muted-foreground">From Agent defaults</span>;
  return (
    <Card id="scorer-defaults" title="Scorer defaults">
      <fieldset disabled={readOnly} className="divide-y">
        <div className="pb-4">
          <FormRow label="Runner" tip="The runner scorer judge runs use." labelWidth="sm:grid-cols-[200px_1fr]" align="start">
            <div className="space-y-1.5">
              <RunnerSelect value={s.runner} onChange={(v) => setS({ ...s, runner: v })} runners={runners} defaultRunner={yaml.agentDefaults?.runner ?? undefined} inherit onEdit={(n) => onRunner(n)} onNew={() => onRunner()} disabled={readOnly} />
              {!s.runner && inherited}
            </div>
          </FormRow>
        </div>
        {(["secrets", "mcpServers"] as const).map((k) => (
          <div key={k} className="py-4 last:pb-0">
            <FormRow label={k === "secrets" ? "Secrets" : "MCPs"} labelWidth="sm:grid-cols-[200px_1fr]" align="start">
              {s[k] === null ? (
                <div className="flex items-start justify-between gap-3 sm:pt-2">
                  <div className="space-y-1.5">
                    <div className="text-sm text-muted-foreground">--</div>
                    {inherited}
                  </div>
                  <button type="button" className="text-sm font-medium text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400" onClick={() => setS({ ...s, [k]: [] })}>
                    Customize
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <ResourceList kind={k === "secrets" ? "secret" : "mcp"} value={s[k] ?? []} onChange={(v) => setS({ ...s, [k]: v })} secrets={secrets} mcps={mcps} factory={factory} />
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setS({ ...s, [k]: null })}>
                    Use agent defaults
                  </button>
                </div>
              )}
            </FormRow>
          </div>
        ))}
      </fieldset>
      <SaveBar
        dirty={!same(s, initial)}
        pending={pending}
        readOnly={readOnly}
        onReset={() => setS(initial)}
        onSave={() => save({ "scorerDefaults.runner": s.runner || undefined, "scorerDefaults.secrets": s.secrets ?? undefined, "scorerDefaults.mcpServers": s.mcpServers ?? undefined }, "Update scorer defaults")}
      />
    </Card>
  );
}

function Benchmarking({ factory, yaml, routers, readOnly }: Pick<Props, "factory" | "yaml" | "routers" | "readOnly">) {
  const initial = yaml.scoring?.defaultModel ?? "";
  const [model, setModel] = useState(initial);
  const [pending, save] = useSave(factory);
  return (
    <Card id="scoring" title="Benchmarking">
      <Field title="Default benchmark model" hint="Used for managed benchmark scoring.">
        <ModelSelect value={model} onChange={setModel} harness="" routers={routers} inheritLabel="" placeholder="Default (platform judge)" disabled={readOnly} />
      </Field>
      <SaveBar dirty={model !== initial} pending={pending} readOnly={readOnly} onReset={() => setModel(initial)} onSave={() => save({ "scoring.defaultModel": model || undefined }, "Update benchmark model")} />
    </Card>
  );
}

const REVIEWERS = { none: "No assignment", admins: "Team admins", team: "All team members", custom: "Custom list" };
const REVIEWER_HINT: Record<string, string> = { none: "Pull requests are opened without a reviewer.", admins: "One eligible team admin is randomly chosen to review.", team: "One team member is randomly chosen to review.", custom: "One person from the list is randomly chosen to review." };

function SelfImprovement({ factory, yaml, routers, scorers, readOnly }: Pick<Props, "factory" | "yaml" | "routers" | "scorers" | "readOnly">) {
  const initial = useMemo(() => {
    const si = yaml.selfImprovement ?? {};
    return { model: si.model ?? "", threshold: si.failedRunThreshold ?? 25, reviewers: si.reviewers?.type ?? "admins", emails: (si.reviewers?.emails ?? []).join(", "), scorers: si.scorers ?? scorers.map((x) => x.slug) };
  }, [yaml.selfImprovement, scorers]);
  const [s, setS] = useState(initial);
  const [pending, save] = useSave(factory);
  const thresholdOk = Number.isInteger(s.threshold) && s.threshold >= 1 && s.threshold <= 50;
  return (
    <Card id="self-improvement" title="Self-improvement">
      <fieldset disabled={readOnly} className="space-y-4">
        <FormRow label="Model" tip="The model self-improvement runs use. Leave it empty to use the default." labelWidth="sm:grid-cols-[200px_1fr]">
          <ModelSelect value={s.model || DEFAULT_MODEL} onChange={(v) => setS({ ...s, model: v })} harness="" routers={routers} defaultModel={DEFAULT_MODEL} disabled={readOnly} />
        </FormRow>
        <FormRow label="Threshold" tip="Scored failing runs an agent needs before self-improvement runs on a schedule. Allowed values are 1 to 50." labelWidth="sm:grid-cols-[200px_1fr]">
          <div className="flex items-center gap-2">
            <Input type="number" min={1} max={50} value={s.threshold} onChange={(e) => setS({ ...s, threshold: Number(e.target.value) })} className="h-10 w-20 bg-background" aria-label="Threshold" aria-invalid={!thresholdOk} />
            <span className="text-sm text-muted-foreground">failed runs</span>
          </div>
          {!thresholdOk && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Use a whole number from 1 to 50.</p>}
        </FormRow>
        <FormRow label="Reviewers" tip="Request a review for pull requests and factory reviews created by self-improvement." labelWidth="sm:grid-cols-[200px_1fr]" align="start">
          <div className="space-y-2">
            <Select items={REVIEWERS} value={s.reviewers} onValueChange={(v) => setS({ ...s, reviewers: String(v) })} disabled={readOnly}>
              <SelectTrigger className="h-10 w-full bg-background" aria-label="Reviewers">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REVIEWERS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {s.reviewers === "custom" && <Input value={s.emails} onChange={(e) => setS({ ...s, emails: e.target.value })} placeholder="ann@acme.com, bob@acme.com" className="h-10 bg-background" aria-label="Reviewer emails" />}
            <p className="text-sm text-muted-foreground">{REVIEWER_HINT[s.reviewers]}</p>
          </div>
        </FormRow>
        <FormRow label="Scorers" tip="Failures from enabled scorers are included in self-improvement runs." labelWidth="sm:grid-cols-[200px_1fr]" align="start">
          <div className="space-y-2">
            <Popover>
              <PopoverTrigger render={<Button variant="outline" className="h-10 w-full justify-between bg-background font-normal text-muted-foreground" />}>Select…</PopoverTrigger>
              <PopoverContent align="start" className="w-(--anchor-width) p-1">
                {scorers.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No scorers in this factory yet.</p>}
                {scorers.map((x) => (
                  <label key={x.slug} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={s.scorers.includes(x.slug)} onCheckedChange={(c) => setS({ ...s, scorers: c ? [...s.scorers, x.slug] : s.scorers.filter((y) => y !== x.slug) })} />
                    {x.name}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
            <div className="flex flex-wrap gap-1.5">
              {s.scorers.map((slug) => (
                <span key={slug} className="rounded-md border bg-background px-2 py-0.5 text-xs">
                  {scorers.find((x) => x.slug === slug)?.name ?? slug}
                </span>
              ))}
            </div>
          </div>
        </FormRow>
      </fieldset>
      <SaveBar
        dirty={!same(s, initial)}
        pending={pending}
        readOnly={readOnly}
        onReset={() => setS(initial)}
        onSave={() => {
          if (!thresholdOk) return void toast.error("Threshold must be 1 to 50.");
          const emails = s.emails.split(",").map((e) => e.trim()).filter(Boolean);
          save(
            {
              "selfImprovement.model": s.model && s.model !== DEFAULT_MODEL ? s.model : undefined,
              "selfImprovement.failedRunThreshold": s.threshold,
              "selfImprovement.reviewers": { type: s.reviewers, ...(s.reviewers === "custom" ? { emails } : {}) },
              "selfImprovement.scorers": same([...s.scorers].sort(), scorers.map((x) => x.slug).sort()) ? undefined : s.scorers,
            },
            "Update self-improvement settings",
          );
        }}
      />
    </Card>
  );
}

/* ---------- Integrations ---------- */

type ChatType = "slack" | "microsoft-teams" | "discord" | "linear" | "jira";
const INTEGRATIONS: { type: ChatType | "github" | "gitlab"; label: string; icon: React.ComponentType<{ className?: string }>; describe: (alias: string) => string; option?: "channels" | "teams" | "projects"; providers: string[] }[] = [
  { type: "jira", label: "Jira", icon: JiraIcon, describe: (a) => `Bring tickets into your factory by mentioning @${a} or assigning to the factory agent.`, option: "projects", providers: ["jira"] },
  { type: "linear", label: "Linear", icon: LinearIcon, describe: (a) => `Bring issues into your factory by mentioning @${a} or assigning to the factory agent.`, option: "teams", providers: ["linear"] },
  { type: "microsoft-teams", label: "Microsoft Teams", icon: TeamsIcon, describe: (a) => `Bring conversations into your factory by mentioning @${a} in selected standard or shared channels. Private channels are not supported.`, option: "channels", providers: ["microsoft-teams", "teams"] },
  { type: "slack", label: "Slack", icon: SlackIcon, describe: (a) => `Tag your factory directly @${a}.`, option: "channels", providers: ["slack"] },
  { type: "discord", label: "Discord", icon: DiscordIcon, describe: (a) => `Mention @${a} in the selected Discord channels.`, option: "channels", providers: ["discord"] },
  { type: "github", label: "GitHub", icon: GitHubIcon, describe: (a) => `Label your PRs factory:${a} and tag @kiln-factory on issues or PRs.`, providers: ["github"] },
];

const entryType = (e: IntegrationEntry) => (typeof e === "string" ? (e === "teams" ? "microsoft-teams" : e) : e.type === "teams" ? "microsoft-teams" : e.type);

function settingsKeys(type: ChatType): { key: string; label: string } {
  if (type === "linear") return { key: "teams", label: "Linear teams" };
  if (type === "jira") return { key: "projectKeys", label: "Jira projects" };
  if (type === "discord") return { key: "channelIds", label: "Channels" };
  return { key: "channels", label: "Channels" };
}

function IntegrationSettingsDialog({ type, label, connection, entry, onSave, onClose }: { type: ChatType; label: string; connection?: Connection; entry: Record<string, unknown>; onSave: (settings: Record<string, unknown>) => void; onClose: () => void }) {
  const { key, label: listLabel } = settingsKeys(type);
  const current = ((entry[type] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const [selected, setSelected] = useState<string[]>((current[key] as string[] | undefined) ?? []);
  const [autoRespond, setAutoRespond] = useState(current.autoRespondToThreadReplies !== false);
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [manual, setManual] = useState("");
  const kind = INTEGRATIONS.find((i) => i.type === type)?.option ?? "channels";
  useEffect(() => {
    if (connection) loadConnectionOptions(connection.id, kind).then(setOptions);
    else setOptions([]);
  }, [connection, kind]);
  const chat = type === "slack" || type === "microsoft-teams" || type === "discord";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label} settings</DialogTitle>
          <DialogDescription>{type === "microsoft-teams" ? "Pick the standard or shared channels the foreman listens in. Teams channel ids look like 19:…@thread.tacv2." : `Choose the ${listLabel.toLowerCase()} this factory works with. Leave empty for all.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm font-medium">{listLabel}</div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1">
            {options === null && <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>}
            {options?.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{connection ? "Nothing to pick from this connection yet; add ids below." : "Connect the workspace first, or add ids below."}</p>}
            {options?.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={selected.includes(o.id) || selected.includes(o.name)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, type === "linear" || type === "jira" ? o.name : o.id] : s.filter((x) => x !== o.id && x !== o.name)))} />
                {o.name}
              </label>
            ))}
            {selected
              .filter((x) => !options?.some((o) => o.id === x || o.name === x))
              .map((x) => (
                <label key={x} className="flex items-center gap-2 rounded px-2 py-1.5 font-mono text-xs">
                  <Checkbox checked onCheckedChange={() => setSelected((s) => s.filter((y) => y !== x))} />
                  {x}
                </label>
              ))}
          </div>
          <div className="flex gap-2">
            <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={type === "jira" ? "Project key, e.g. ENG" : type === "linear" ? "Team key, e.g. ENG" : "Channel id"} aria-label={`Add ${listLabel}`} />
            <Button
              variant="outline"
              onClick={() => {
                if (manual.trim()) setSelected((s) => [...new Set([...s, manual.trim()])]);
                setManual("");
              }}
            >
              Add
            </Button>
          </div>
          {chat && (
            <label className="flex items-start justify-between gap-4 rounded-md border p-3">
              <span>
                <span className="block text-sm font-medium">Reply in threads without a mention</span>
                <span className="block text-xs text-muted-foreground">Plain replies in a factory thread continue the work. Off: people must mention @alias.</span>
              </span>
              <Switch checked={autoRespond} onCheckedChange={setAutoRespond} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ ...(selected.length ? { [key]: selected } : {}), ...(chat && !autoRespond ? { autoRespondToThreadReplies: false } : {}) })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloudDialog({ kind, yaml, onSave, onClose }: { kind: "aws" | "gcp"; yaml: FactoryYaml; onSave: (patch: Record<string, unknown>) => void; onClose: () => void }) {
  const aws = yaml.cloudProviders?.aws;
  const gcp = yaml.cloudProviders?.gcp;
  const [roleArn, setRoleArn] = useState(aws?.roleArn ?? "");
  const [g, setG] = useState({ projectNumber: gcp?.projectNumber ?? "", workloadIdentityFederationPoolId: gcp?.workloadIdentityFederationPoolId ?? "", workloadIdentityFederationProviderId: gcp?.workloadIdentityFederationProviderId ?? "", serviceAccountEmail: gcp?.serviceAccountEmail ?? "" });
  const arnOk = /^arn:aws[a-z-]*:iam::\d{12}:role\/.+/.test(roleArn);
  const gcpOk = /^\d+$/.test(g.projectNumber) && g.workloadIdentityFederationPoolId && g.workloadIdentityFederationProviderId;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "aws" ? "Amazon Web Services" : "Google Cloud"}</DialogTitle>
          <DialogDescription>{kind === "aws" ? "Runs get AWS_ROLE_ARN and a web identity token, so the AWS CLI and SDKs assume this IAM role." : "Runs get a credential config for Workload Identity Federation, so gcloud and the GCP SDKs authenticate without keys."}</DialogDescription>
        </DialogHeader>
        {kind === "aws" ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="aws-role">
              IAM role ARN
            </label>
            <Input id="aws-role" value={roleArn} onChange={(e) => setRoleArn(e.target.value.trim())} placeholder="arn:aws:iam::123456789012:role/kiln-factory" className="font-mono text-xs" aria-invalid={!!roleArn && !arnOk} />
            {roleArn && !arnOk && <p className="text-xs text-red-600 dark:text-red-400">Use an IAM role ARN.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {(
              [
                ["projectNumber", "Project number", "123456789012"],
                ["workloadIdentityFederationPoolId", "Workload identity pool id", "kiln-pool"],
                ["workloadIdentityFederationProviderId", "Provider id", "kiln-provider"],
                ["serviceAccountEmail", "Service account email (optional)", "factory@project.iam.gserviceaccount.com"],
              ] as const
            ).map(([k, l, ph]) => (
              <div key={k} className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor={`gcp-${k}`}>
                  {l}
                </label>
                <Input id={`gcp-${k}`} value={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.value.trim() })} placeholder={ph} className="font-mono text-xs" />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          {(kind === "aws" ? aws : gcp) && (
            <Button variant="ghost" className="mr-auto text-red-600" onClick={() => onSave({ [`cloudProviders.${kind}`]: undefined })}>
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={kind === "aws" ? !arnOk : !gcpOk}
            onClick={() => onSave(kind === "aws" ? { "cloudProviders.aws": { roleArn } } : { "cloudProviders.gcp": Object.fromEntries(Object.entries(g).filter(([, v]) => v)) })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Integrations({ factory, binding, yaml, connections, readOnly }: Pick<Props, "factory" | "binding" | "yaml" | "connections" | "readOnly">) {
  const [pending, save] = useSave(factory);
  const [editing, setEditing] = useState<ChatType | null>(null);
  const [cloud, setCloud] = useState<"aws" | "gcp" | null>(null);
  const entries = yaml.integrations ?? [];
  const enabled = new Set(entries.map(entryType));
  const forges = new Set((yaml.repositories ?? []).map((r) => r.forge ?? "github"));
  const connFor = (providers: string[]) => connections.find((c) => providers.includes(c.provider));
  const write = (next: IntegrationEntry[], msg: string) => save({ integrations: next.length ? next : undefined }, msg, () => setEditing(null));
  const toggle = (type: ChatType, on: boolean) => {
    let next = entries.filter((e) => entryType(e) !== type);
    if (on) {
      const other = type === "linear" ? "jira" : type === "jira" ? "linear" : null;
      if (other && enabled.has(other)) {
        next = next.filter((e) => entryType(e) !== other);
        toast.message(`${other === "jira" ? "Jira" : "Linear"} was turned off: a factory uses Linear or Jira, not both.`);
      }
      next = [...next, type];
    }
    write(next, `${on ? "Enable" : "Disable"} ${type}`);
  };
  const entryOf = (type: ChatType) => {
    const e = entries.find((x) => entryType(x) === type);
    return typeof e === "object" ? e : { type };
  };
  return (
    <Card id="integrations" title="Factory integrations">
      <ul className="space-y-5">
        {INTEGRATIONS.map((i) => {
          const conn = connFor(i.providers);
          const isForge = i.type === "github" || i.type === "gitlab";
          const on = isForge ? forges.has(i.type) : enabled.has(i.type);
          const Icon = i.icon;
          return (
            <li key={i.type} className="flex items-center gap-4">
              <Icon className="size-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{i.label}</div>
                <p className="text-sm text-muted-foreground">{i.describe(binding.alias)}</p>
                {!isForge && on && !conn && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">Enabled, but the workspace is not connected yet.</p>}
              </div>
              {isForge ? (
                on && conn ? (
                  <ConnectedPill />
                ) : (
                  <Button variant="outline" render={<Link href="/integrations" />} nativeButton={false}>
                    Connect
                  </Button>
                )
              ) : !conn && !on ? (
                <Button variant="outline" render={<Link href={`/integrations?connect=${i.providers[0]}`} />} nativeButton={false}>
                  Connect
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {on && conn && <ConnectedPill />}
                  {on && (
                    <Button variant="ghost" size="icon-sm" aria-label={`${i.label} settings`} onClick={() => setEditing(i.type as ChatType)} disabled={readOnly}>
                      <Settings2 />
                    </Button>
                  )}
                  <Switch checked={on} onCheckedChange={(c) => toggle(i.type as ChatType, c)} disabled={readOnly || pending} aria-label={`Use ${i.label} in this factory`} />
                </div>
              )}
            </li>
          );
        })}
        {(["aws", "gcp"] as const).map((k) => {
          const set = !!yaml.cloudProviders?.[k];
          return (
            <li key={k} className="flex items-center gap-4">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md text-xs font-bold", k === "aws" ? "text-[#ff9900]" : "text-[#4285f4]")}>
                {k === "aws" ? "aws" : <Cloud className="size-8" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{k === "aws" ? "Amazon Web Services" : "Google Cloud"}</div>
                <p className="text-sm text-muted-foreground">{k === "aws" ? "Automatically configure the AWS CLI and SDKs to authenticate using this IAM role." : "Automatically configure gcloud and GCP SDKs to authenticate using Workload Identity Federation."}</p>
                {set && <p className="truncate font-mono text-xs text-muted-foreground">{k === "aws" ? yaml.cloudProviders!.aws!.roleArn : `project ${yaml.cloudProviders!.gcp!.projectNumber}`}</p>}
              </div>
              <Button variant="outline" onClick={() => setCloud(k)} disabled={readOnly}>
                {set ? "Edit" : "Set up"}
              </Button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <IntegrationSettingsDialog
          type={editing}
          label={INTEGRATIONS.find((i) => i.type === editing)!.label}
          connection={connFor(INTEGRATIONS.find((i) => i.type === editing)!.providers)}
          entry={entryOf(editing)}
          onClose={() => setEditing(null)}
          onSave={(settings) => write(entries.map((e) => (entryType(e) === editing ? (Object.keys(settings).length ? { type: editing, [editing]: settings } : editing) : e)), `Update ${editing} settings`)}
        />
      )}
      {cloud && <CloudDialog kind={cloud} yaml={yaml} onClose={() => setCloud(null)} onSave={(patch) => save(patch, `Update ${cloud.toUpperCase()} identity`, () => setCloud(null))} />}
    </Card>
  );
}

function ConnectedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Connected
    </span>
  );
}

/* ---------- Factory repo ---------- */

function MigrateDialog({ factory, alias, connections, onClose }: { factory: string; alias: string; connections: Connection[]; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const gh = connections.find((c) => c.provider === "github");
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const [org, setOrg] = useState("");
  const [name, setName] = useState(`${alias}-config`);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (!gh) return setOrgs([]);
    loadConnectionOptions(gh.id, "orgs").then((o) => {
      setOrgs(o);
      if (o[0]) setOrg(o[0].name);
    });
  }, [gh]);
  const titles = ["Name your repo", "Create the repository", "Move the definition"];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[500px]" showCloseButton={false}>
        <div className="flex h-36 items-center justify-center gap-4 bg-gradient-to-br from-violet-700 to-violet-950">
          <span className="flex size-14 items-center justify-center rounded-xl bg-white/15 text-xl font-bold text-white">K</span>
          <span className="tracking-widest text-white/70">···</span>
          <span className="flex size-14 items-center justify-center rounded-xl bg-white">
            <GitHubIcon className="size-8 text-black" />
          </span>
        </div>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {titles[step - 1]} · step {step} of 3
            </span>
            <button type="button" aria-label="Close dialog" onClick={onClose} className="hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div>
            <DialogTitle className="text-lg font-semibold">Migrate to a GitHub repo</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === 1 && "Move this factory's source of truth to a repository in your GitHub org. First, choose where the new repository should live."}
              {step === 2 && "Create an empty repository on GitHub and give the Kiln GitHub app access to it. Kiln pushes the definition there next."}
              {step === 3 && "Kiln pushes the current definition and from then on applies every merge to the default branch. Changes made in Kiln open pull requests."}
            </p>
          </div>
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">GitHub Org</div>
                <p className="text-sm text-muted-foreground">Orgs connected to your team&apos;s Kiln GitHub app.</p>
                {orgs && orgs.length > 0 ? (
                  <Select items={Object.fromEntries(orgs.map((o) => [o.name, o.name]))} value={org} onValueChange={(v) => setOrg(String(v))}>
                    <SelectTrigger className="h-10 w-full" aria-label="GitHub Org">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.name}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={org} onChange={(e) => setOrg(e.target.value.trim())} placeholder={orgs === null ? "Loading orgs…" : "Org or user, e.g. acme"} className="h-10" aria-label="GitHub Org" />
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="migrate-name">
                  Repo name
                </label>
                <p className="text-sm text-muted-foreground">We&apos;ll help you create and push to this repository next.</p>
                <Input id="migrate-name" value={name} onChange={(e) => setName(e.target.value.trim())} className="h-10" />
              </div>
              <Button className="h-10 w-full" disabled={!org || !/^[A-Za-z0-9_.-]+$/.test(name)} onClick={() => setStep(2)}>
                Next
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>
                  Create <span className="font-mono">{org}/{name}</span> (empty, private is fine).
                </li>
                <li>Allow the Kiln GitHub app to access it, so Kiln can push and receive merge webhooks.</li>
              </ol>
              <Button variant="outline" className="h-10 w-full" render={<a href={`https://github.com/new?owner=${encodeURIComponent(org)}&name=${encodeURIComponent(name)}&visibility=private`} target="_blank" rel="noreferrer" />} nativeButton={false}>
                <GitHubIcon /> Create on GitHub <ExternalLink />
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" className="h-10 flex-1" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button className="h-10 flex-1" onClick={() => setStep(3)}>
                  I created it
                </Button>
              </div>
            </>
          )}
          {step === 3 && (
            <div className="flex gap-2">
              <Button variant="ghost" className="h-10 flex-1" onClick={() => setStep(2)} disabled={pending}>
                Back
              </Button>
              <Button
                className="h-10 flex-1"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await migrateToGithub(factory, org, name);
                    if (!r.ok) return void toast.error(r.error ?? "Migration failed");
                    toast.success(`Definition moved to ${org}/${name}`, r.url ? { action: { label: "View", onClick: () => window.open(r.url, "_blank") } } : undefined);
                    onClose();
                    router.refresh();
                  })
                }
              >
                {pending ? "Migrating…" : "Push and migrate"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FactoryRepo({ factory, binding, connections }: Pick<Props, "factory" | "binding" | "connections">) {
  const [migrate, setMigrate] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const repo = binding.repo;
  return (
    <Card id="factory-repo" title="Factory repo" className="space-y-4">
      {repo ? (
        <div className="flex flex-wrap items-center gap-4">
          <GitHubIcon className="size-9" />
          <div className="min-w-0 flex-1">
            <a href={`https://github.com/${repo.owner}/${repo.name}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold hover:underline">
              {repo.owner}/{repo.name} <ExternalLink className="size-3.5" />
            </a>
            <p className="text-sm text-muted-foreground">
              Branch {repo.ref}
              {repo.dir ? `, folder ${repo.dir}` : ""}. Merges apply automatically; changes made here open pull requests.
              {binding.appliedSha && <span className="ml-1 font-mono text-xs">Applied {binding.appliedSha.slice(0, 10)}</span>}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await syncNow(factory);
                if (r.ok) toast.success(`Synced ${r.sha?.slice(0, 10) ?? ""}`);
                else toast.error(r.error ?? "Sync failed");
                router.refresh();
              })
            }
          >
            <RefreshCw className={cn(pending && "animate-spin")} /> Sync now
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-9 items-center justify-center rounded-md bg-foreground text-lg font-bold text-background">K</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Kiln managed repo</div>
            <p className="text-sm text-muted-foreground">Your factory definition is hosted by Kiln but you can move it over to GitHub at any time.</p>
          </div>
          <Button variant="outline" onClick={() => setMigrate(true)}>
            <GitHubIcon /> Migrate to GitHub
          </Button>
        </div>
      )}
      {binding.canary && <CanaryRow factory={factory} canary={binding.canary} />}
      {migrate && <MigrateDialog factory={factory} alias={binding.alias} connections={connections} onClose={() => setMigrate(false)} />}
    </Card>
  );
}

function CanaryRow({ factory, canary }: { factory: string; canary: NonNullable<Binding["canary"]> }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (a: "promote" | "rollback") =>
    start(async () => {
      const r = await canaryAction(factory, a);
      if (r.ok) toast.success(a === "promote" ? "Canary promoted" : "Canary rolled back");
      else toast.error(r.error ?? "Failed");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
      <span className="flex-1">
        Canary definition <code className="font-mono text-xs">{canary.sha.slice(0, 10)}</code> gets {canary.percent}% of new work items.
        <InfoTip title="Canary">New work items are split between the applied definition and the canary; compare them on the dashboard, then promote or roll back.</InfoTip>
      </span>
      <Button size="sm" onClick={() => act("promote")} disabled={pending}>
        Promote
      </Button>
      <Button size="sm" variant="outline" onClick={() => act("rollback")} disabled={pending}>
        Roll back
      </Button>
    </div>
  );
}

/* ---------- Runners ---------- */

function Runners({ factory, runners, defaults, readOnly, onRunner }: Pick<Props, "factory" | "runners" | "defaults" | "readOnly"> & { onRunner: (name?: string) => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card
      id="runners"
      title="Runners"
      className="space-y-2 p-3"
      action={
        <Button variant="outline" onClick={() => onRunner()} disabled={readOnly}>
          <Plus /> New runner
        </Button>
      }
    >
      {runners.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No runners yet. Add one to choose the image, setup commands and machine size of agent workspaces.</p>}
      {runners.map((r) => (
        <div key={r.name} className="flex items-center gap-3 rounded-lg px-3 py-3">
          <span className="flex size-10 items-center justify-center rounded-full border bg-background">
            <Server className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {r.name}
              {r.name === defaults.runner && <DefaultBadge />}
            </div>
            <div className="truncate text-sm text-muted-foreground">{r.os === "macos" ? "macOS" : r.os === "windows" ? "Windows" : "Linux"}{r.description ? ` · ${r.description}` : ""}</div>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit runner ${r.name}`} onClick={() => onRunner(r.name)}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete runner ${r.name}`}
            disabled={readOnly || pending || r.name === defaults.runner}
            onClick={() =>
              start(async () => {
                const res = await deleteRunner(factory, r.name);
                if (!res.ok) toast.error(res.error);
                else toast.success(res.pullRequest ? "Pull request opened" : `Runner ${r.name} deleted`);
                router.refresh();
              })
            }
          >
            <Trash />
          </Button>
        </div>
      ))}
    </Card>
  );
}

/* ---------- Danger zone ---------- */

function DangerZone({ factory, binding }: Pick<Props, "factory" | "binding">) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card id="danger-zone" title="Danger zone">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Delete factory</div>
          <p className="text-sm text-muted-foreground">Factory deletion cannot be undone.</p>
        </div>
        <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10" onClick={() => setOpen(true)}>
          Delete Factory
        </Button>
      </div>
      <AlertDialog open={open} onOpenChange={(o) => (setOpen(o), setTyped(""))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {binding.name}?</AlertDialogTitle>
            <AlertDialogDescription>This deletes the factory, its automations and run history, and removes its factory:{binding.alias} labels and chat app installs. Type the factory name to confirm.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={binding.name} aria-label="Factory name" autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={typed !== binding.name || pending}
              onClick={() =>
                start(async () => {
                  const r = await removeFactory(factory);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`${binding.name} deleted`);
                  setOpen(false);
                  router.push("/runs/new");
                  router.refresh();
                })
              }
            >
              Delete factory
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ---------- Page ---------- */

export function SettingsView(p: Props) {
  const [runner, setRunner] = useState<{ open: boolean; name?: string }>({ open: false });
  const router = useRouter();
  const onRunner = (name?: string) => setRunner({ open: true, name });
  return (
    <div className="mx-auto w-full max-w-[820px] space-y-10 px-4 pt-8 pb-10">
      {p.readOnly && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          This factory&apos;s definition lives in {p.binding.repo?.owner}/{p.binding.repo?.name}. Settings are read-only here; change factory.yaml in the repository.
        </div>
      )}
      <GeneralInfo {...p} />
      <AgentDefaults {...p} onRunner={onRunner} />
      <ScorerDefaults {...p} onRunner={onRunner} />
      <Benchmarking {...p} />
      <SelfImprovement {...p} />
      <Integrations {...p} />
      <FactoryRepo {...p} />
      <Runners {...p} onRunner={onRunner} />
      {p.memories}
      <DangerZone {...p} />
      <RunnerDialog
        factory={p.factory}
        open={runner.open}
        onOpenChange={(o) => setRunner((s) => ({ ...s, open: o }))}
        name={runner.name}
        runner={runner.name ? p.runnerFiles[runner.name] : undefined}
        isDefault={!!runner.name && runner.name === p.defaults.runner}
        secrets={p.secrets}
        readOnly={p.readOnly}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
