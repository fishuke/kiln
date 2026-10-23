"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, CircleX, Loader2, Search, Upload, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { connectRepo } from "@/app/actions";
import { loadConnectionOptions, uploadFile } from "@/app/f/[factory]/settings/actions";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { AzureDevOpsIcon, BitbucketIcon, DiscordIcon, GitHubIcon, GitLabIcon, JiraIcon, LinearIcon, SlackIcon, TeamsIcon } from "@/components/kiln/brand-icons";
import { Markdown } from "@/components/kiln/markdown";
import { ModelSelect } from "@/components/kiln/resource-pickers";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Connection } from "@/lib/api/factory-admin";
import { modelLabel } from "@/lib/agent-catalog";
import { toAlias, validateAlias } from "@/lib/alias";
import { availableTemplates, MODEL_PRESETS, type AutomationTemplate, type WizardInput } from "@/lib/factory-template";
import { cn } from "@/lib/utils";
import { createFactoryFromWizard, testConnections, type ConnectionCheck } from "./actions";

type Forge = NonNullable<WizardInput["forge"]>;
const FORGES: { id: Forge; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "github", label: "GitHub", icon: GitHubIcon },
  { id: "gitlab", label: "GitLab", icon: GitLabIcon },
  { id: "azure_devops", label: "Azure DevOps", icon: AzureDevOpsIcon },
  { id: "bitbucket", label: "Bitbucket", icon: BitbucketIcon },
];
const CHATS = [
  { id: "slack" as const, label: "Slack", icon: SlackIcon, hint: "Mention the foreman in channels it is invited to." },
  { id: "microsoft-teams" as const, label: "Microsoft Teams", icon: TeamsIcon, hint: "Pick connected teams and at least one standard channel." },
  { id: "discord" as const, label: "Discord", icon: DiscordIcon, hint: "Mention the foreman in the selected channels." },
];
const AGENT_TOGGLES = [
  { id: "triage" as const, type: "TRIAGE", label: "Triage", description: "Researches requests, reproduces bugs and keeps issues tidy." },
  { id: "spec" as const, type: "SPEC", label: "Spec", description: "Interviews you and writes specs for approval before code." },
  { id: "implement" as const, type: "IMPLEMENT", label: "Code", description: "Implements the change with tests and opens the pull request." },
  { id: "review" as const, type: "REVIEW", label: "Review", description: "Reviews every factory pull request adversarially." },
];
const STEPS = ["Connect your code hosts", "Set up your factory", "Configure your factory agents", "Communications", "Connect your issue tracker", "Cost management", "Initial automations", "Summary", "Test connections"];

const PREVIEW = `I'm starting a first review of this pull request.

### Overview

This PR adds a delivery estimate to the product page, reads the shopper's postcode from the session and covers both acceptance criteria with Playwright tests.

### Concerns

- The estimate is computed on every render; cache it per postcode so the product page stays fast under load.

### Verdict

Found: 0 critical, 1 important, 0 suggestions`;

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((_, i) => (
        <span key={i} className={cn("h-1.5 w-10 rounded-full", i <= step ? "bg-violet-500" : "bg-muted")} />
      ))}
    </div>
  );
}

function OptionCard({ selected, onClick, children, dashed }: { selected?: boolean; onClick?: () => void; children: React.ReactNode; dashed?: boolean }) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={cn("flex items-center gap-4 rounded-xl border bg-muted/30 px-6 py-5 transition-colors", dashed && "border-dashed", onClick && "cursor-pointer hover:bg-muted/60", selected && "border-violet-500 bg-violet-50/60 ring-1 ring-violet-500 dark:bg-violet-500/10")}
    >
      {children}
    </div>
  );
}

function ConnectButton({ provider, connected }: { provider: string; connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
      <span className="size-1.5 rounded-full bg-emerald-500" /> Connected
    </span>
  ) : (
    <Button variant="outline" onClick={(e) => e.stopPropagation()} render={<Link href={`/integrations?connect=${provider}&return=/create`} />} nativeButton={false}>
      Connect
    </Button>
  );
}

export function CreateWizard({ connections, takenAliases, templates }: { connections: Connection[]; takenAliases: string[]; templates: AutomationTemplate[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"wizard" | "import">("wizard");
  const [step, setStep] = useState(0);
  const conn = (p: string) => connections.find((c) => c.provider === p || (p === "microsoft-teams" && c.provider === "teams"));

  const [forge, setForge] = useState<Forge | "none" | null>(null);
  const [repos, setRepos] = useState<{ owner: string; name: string }[]>([]);
  const [repoOptions, setRepoOptions] = useState<{ id: string; name: string }[]>([]);
  const [repoQuery, setRepoQuery] = useState("");
  const [setup, setSetup] = useState("git clone https://example.com/acme/app.git .\nnpm install");
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [aliasTouched, setAliasTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [avatarKey, setAvatarKey] = useState("");
  const [agents, setAgents] = useState<WizardInput["agents"]>(["triage", "spec", "implement", "review"]);
  const [chat, setChat] = useState<WizardInput["chat"]>([]);
  const [tracker, setTracker] = useState<WizardInput["tracker"]>(null);
  const [trackerOptions, setTrackerOptions] = useState<{ id: string; name: string }[]>([]);
  const [selfImprovement, setSelfImprovement] = useState(true);
  const [preset, setPreset] = useState<WizardInput["preset"]>("quality");
  const [models, setModels] = useState<Record<string, string>>(MODEL_PRESETS.quality);
  const [automations, setAutomations] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<ConnectionCheck[] | null>(null);
  const [enableLearning, setEnableLearning] = useState(true);
  const [firstTask, setFirstTask] = useState("");
  const [pending, start] = useTransition();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const effectiveAlias = aliasTouched ? alias : toAlias(name);
  const aliasError = name || aliasTouched ? validateAlias(effectiveAlias, takenAliases) : null;
  const have = useMemo(() => [...(forge && forge !== "none" ? [forge] : []), ...chat.map((c) => c.type), ...(tracker ? [tracker.type] : [])], [forge, chat, tracker]);
  const offered = useMemo(() => availableTemplates(templates, have), [templates, have]);
  const chosenAutomations = automations ?? offered.filter((t) => ["github-issues", "linear-issues", "review-comments", "ci-failures"].includes(t.id)).map((t) => t.id);

  useEffect(() => {
    if (!forge || forge === "none") return;
    const c = conn(forge);
    if (c) loadConnectionOptions(c.id, "repositories").then(setRepoOptions);
    else setRepoOptions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forge]);
  useEffect(() => {
    if (!tracker) return;
    const c = conn(tracker.type);
    if (c) loadConnectionOptions(c.id, tracker.type === "linear" ? "teams" : "projects").then(setTrackerOptions);
    else setTrackerOptions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracker?.type]);

  const input = (): WizardInput => ({
    name,
    alias: effectiveAlias,
    description,
    avatarKey: avatarKey || undefined,
    forge: forge && forge !== "none" ? forge : null,
    repositories: repos,
    setupCommands: forge === "none" ? setup.split("\n").map((l) => l.trim()).filter(Boolean) : [],
    agents,
    chat,
    tracker,
    selfImprovement,
    preset,
    models,
    automations: chosenAutomations,
  });

  const canNext = [
    !!forge,
    !!name.trim() && !aliasError && (forge === "none" || repos.length > 0),
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ][step];

  const next = () => {
    if (step === 7) start(async () => setChecks(await testConnections(have)));
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const create = () =>
    start(async () => {
      const r = await createFactoryFromWizard(input(), { enableLearning, firstTask });
      if (!r.ok) {
        toast.error(r.error, { description: r.errors?.slice(1, 4).join("\n") });
        return;
      }
      toast.success(`${name} is ready`);
      router.push(r.workItem ? `/runs/${r.workItem}` : `/f/${r.factory}/dashboard`);
      router.refresh();
    });

  const addRepo = (full: string) => {
    const [owner, n] = full.trim().replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "").split("/");
    if (!owner || !n) return void toast.error("Use owner/name, e.g. acme/web.");
    if (!repos.some((r) => r.owner === owner && r.name === n)) setRepos([...repos, { owner, name: n }]);
    if (!name) setName(n.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
    setRepoQuery("");
  };
  const repoMatches = repoOptions.filter((r) => r.name.toLowerCase().includes(repoQuery.toLowerCase()) && !repos.some((x) => `${x.owner}/${x.name}` === r.name)).slice(0, 8);

  const title = mode === "import" ? "Import an existing factory repo" : STEPS[step]!;

  return (
    <div className="fixed inset-0 z-40 flex overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto lg:w-1/2 lg:flex-none">
        <div className="flex items-center px-6 py-5">
          <Link href="/runs/new" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <X className="size-4" /> Exit
          </Link>
        </div>
        <div className="mx-auto w-full max-w-[640px] flex-1 px-6 pt-6 pb-16 sm:px-12">
          {mode === "wizard" && <Progress step={step} />}
          <h1 className="mt-10 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>

          {mode === "import" && (
            <div className="mt-4 space-y-6">
              <p className="text-base text-muted-foreground">Point Kiln at a repository that already holds a factory definition (factory.yaml at the root or in a folder). Kiln validates it, applies it, and applies every later merge to its default branch.</p>
              <form action={connectRepo} className="space-y-3">
                <Input name="repo" required placeholder="owner/repo, e.g. acme/web-factory-config" className="h-11" aria-label="Repository" />
                <div className="flex gap-2">
                  <Input name="ref" placeholder="main" className="h-11 w-36" aria-label="Branch" />
                  <Input name="dir" placeholder="folder (optional)" className="h-11 flex-1" aria-label="Folder" />
                </div>
                <SubmitButton className="h-10">Connect and apply</SubmitButton>
              </form>
              <p className="text-sm text-muted-foreground">
                No repo yet? Scaffold one with <code className="rounded bg-muted px-1 font-mono text-xs">pnpm kiln init web-factory --template sdlc</code> and push it.
              </p>
              <Button variant="ghost" onClick={() => setMode("wizard")}>
                <ArrowLeft /> Back to the guided setup
              </Button>
            </div>
          )}

          {mode === "wizard" && step === 0 && (
            <div className="mt-4 space-y-4">
              <p className="text-base text-muted-foreground">Kiln will connect to your code host so that you can select which repos you want to use in your factory. You can always create a new factory with a different host later.</p>
              <div className="space-y-3 pt-4">
                {FORGES.map((f) => (
                  <OptionCard key={f.id} dashed={forge !== f.id} selected={forge === f.id} onClick={() => setForge(f.id)}>
                    <f.icon className="size-9" />
                    <span className="flex-1 text-lg font-medium">{f.label}</span>
                    <ConnectButton provider={f.id} connected={!!conn(f.id)} />
                  </OptionCard>
                ))}
              </div>
              <button type="button" onClick={() => setForge("none")} className={cn("block w-full text-center text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground", forge === "none" && "font-medium text-foreground")}>
                Don&apos;t have a supported code host? Skip and clone your repo with custom setup commands instead.
              </button>
              <button type="button" onClick={() => setMode("import")} className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
                Already have a factory definition? <span className="font-medium text-foreground">Import an existing factory repo</span>
              </button>
            </div>
          )}

          {mode === "wizard" && step === 1 && (
            <div className="mt-6 space-y-6">
              {forge === "none" ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="setup">
                    Setup commands
                  </label>
                  <Textarea id="setup" value={setup} onChange={(e) => setSetup(e.target.value)} rows={4} className="font-mono text-xs" />
                  <p className="text-xs text-muted-foreground">Each line runs in the workspace root (/workspace) before every run. Clone your code here.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Repositories</div>
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={repoQuery} onChange={(e) => setRepoQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRepo(repoQuery))} placeholder="Search repos or type owner/name and press Enter" className="h-11 pl-9" aria-label="Search repos" />
                    {repoQuery && repoMatches.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover p-1 shadow-md">
                        {repoMatches.map((m) => (
                          <button key={m.id} type="button" onClick={() => addRepo(m.name)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {repos.map((r) => (
                      <span key={`${r.owner}/${r.name}`} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-sm">
                        {r.owner}/{r.name}
                        <button type="button" aria-label={`Remove ${r.owner}/${r.name}`} onClick={() => setRepos(repos.filter((x) => x !== r))} className="text-muted-foreground hover:text-foreground">
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  {!conn(forge!) && <p className="text-xs text-muted-foreground">Connect {FORGES.find((f) => f.id === forge)?.label} to search your repos; you can type owner/name meanwhile.</p>}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="fname">
                  Factory name
                </label>
                <Input id="fname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Storefront" className="h-11" maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="falias">
                  Foreman name
                </label>
                <div className="relative">
                  <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">@</span>
                  <Input
                    id="falias"
                    value={effectiveAlias}
                    onChange={(e) => {
                      setAliasTouched(true);
                      setAlias(e.target.value.toLowerCase().replace(/^@/, ""));
                    }}
                    className="h-11 pl-7"
                    aria-invalid={!!aliasError}
                    maxLength={60}
                  />
                </div>
                <p className={cn("text-xs", aliasError ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{aliasError ?? `People mention @${effectiveAlias || "alias"} in chat and on issues; PRs get the factory:${effectiveAlias || "alias"} label.`}</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="fdesc">
                  Description (optional)
                </label>
                <Textarea id="fdesc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this factory works on" />
              </div>
              <div className="flex items-center gap-3">
                {avatarKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/files/${avatarKey}`} alt="" className="size-10 rounded-md object-cover" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-md bg-emerald-950 text-lg font-semibold text-emerald-50 dark:bg-emerald-800">{(name || "K").charAt(0).toUpperCase()}</span>
                )}
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
                      if (r.ok) setAvatarKey(r.key);
                      else toast.error(r.error);
                    });
                  }}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload /> {uploading ? "Uploading…" : "Add an avatar (optional)"}
                </Button>
              </div>
            </div>
          )}

          {mode === "wizard" && step === 2 && (
            <div className="mt-4 space-y-3">
              <p className="pb-2 text-base text-muted-foreground">People talk to the foreman; it dispatches the other agents. You can add custom agents later.</p>
              <OptionCard>
                <AgentTypeIcon type="FOREMAN" />
                <div className="flex-1">
                  <div className="font-semibold">Foreman</div>
                  <div className="text-sm text-muted-foreground">@{effectiveAlias} · always on. Routes work and talks to people.</div>
                </div>
                <Switch checked disabled aria-label="Foreman" />
              </OptionCard>
              {AGENT_TOGGLES.map((a) => (
                <OptionCard key={a.id}>
                  <AgentTypeIcon type={a.type} />
                  <div className="flex-1">
                    <div className="font-semibold">{a.label}</div>
                    <div className="text-sm text-muted-foreground">{a.description}</div>
                  </div>
                  <Switch checked={agents.includes(a.id)} onCheckedChange={(c) => setAgents(c ? [...agents, a.id] : agents.filter((x) => x !== a.id))} aria-label={a.label} />
                </OptionCard>
              ))}
            </div>
          )}

          {mode === "wizard" && step === 3 && (
            <div className="mt-4 space-y-3">
              <p className="pb-2 text-base text-muted-foreground">Where people talk to @{effectiveAlias}. Pick any; you can change this in settings.</p>
              {CHATS.map((c) => {
                const on = chat.find((x) => x.type === c.id);
                return (
                  <OptionCard key={c.id} selected={!!on}>
                    <c.icon className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{c.label}</div>
                      <div className="text-sm text-muted-foreground">{c.hint}</div>
                      {on && (
                        <Input
                          value={on.channels.join(", ")}
                          onChange={(e) => setChat(chat.map((x) => (x.type === c.id ? { ...x, channels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))}
                          placeholder="Channels (optional), e.g. #eng-help"
                          className="mt-2 h-9"
                          aria-label={`${c.label} channels`}
                        />
                      )}
                    </div>
                    {!conn(c.id) && <ConnectButton provider={c.id} connected={false} />}
                    <Switch checked={!!on} onCheckedChange={(v) => setChat(v ? [...chat, { type: c.id, channels: [] }] : chat.filter((x) => x.type !== c.id))} aria-label={`Use ${c.label}`} />
                  </OptionCard>
                );
              })}
            </div>
          )}

          {mode === "wizard" && step === 4 && (
            <div className="mt-4 space-y-3">
              <p className="pb-2 text-base text-muted-foreground">Bring issues into the factory by assigning them to it. A factory uses Linear or Jira, not both.</p>
              {(
                [
                  ["linear", "Linear", LinearIcon, "Pick Linear teams"],
                  ["jira", "Jira", JiraIcon, "Pick Jira projects"],
                ] as const
              ).map(([id, label, Icon, pick]) => {
                const on = tracker?.type === id;
                return (
                  <OptionCard key={id} selected={on} onClick={() => setTracker(on ? null : { type: id, keys: [] })}>
                    <Icon className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{label}</div>
                      {on ? (
                        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                          {trackerOptions.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {trackerOptions.map((o) => (
                                <label key={o.id} className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-sm">
                                  <Checkbox checked={tracker!.keys.includes(o.name)} onCheckedChange={(c) => setTracker({ type: id, keys: c ? [...tracker!.keys, o.name] : tracker!.keys.filter((k) => k !== o.name) })} />
                                  {o.name}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <Input value={tracker!.keys.join(", ")} onChange={(e) => setTracker({ type: id, keys: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={`${pick} (optional), e.g. ENG`} className="h-9" aria-label={pick} />
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">{pick} after connecting.</div>
                      )}
                    </div>
                    <ConnectButton provider={id} connected={!!conn(id)} />
                  </OptionCard>
                );
              })}
              <button type="button" onClick={() => setTracker(null)} className="text-sm text-muted-foreground hover:text-foreground">
                Skip — I&apos;ll use GitHub issues only
              </button>
            </div>
          )}

          {mode === "wizard" && step === 5 && (
            <div className="mt-4 space-y-5">
              <OptionCard>
                <div className="flex-1">
                  <div className="font-semibold">Enable self-improvement</div>
                  <div className="text-sm text-muted-foreground">Seeds five scorers; when failures pile up, the factory proposes prompt and definition fixes as pull requests for you to approve.</div>
                </div>
                <Switch checked={selfImprovement} onCheckedChange={setSelfImprovement} aria-label="Enable self-improvement" />
              </OptionCard>
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
                {(
                  [
                    ["quality", "Higher quality", "Strongest models for planning, coding and review."],
                    ["cost", "Cost-efficient", "Smaller models where they do the job well."],
                  ] as const
                ).map(([id, label, d]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={preset === id}
                    onClick={() => {
                      setPreset(id);
                      setModels(MODEL_PRESETS[id]);
                    }}
                    className={cn("rounded-xl border p-4 text-left", preset === id ? "border-violet-500 ring-1 ring-violet-500" : "hover:bg-muted/50")}
                  >
                    <div className="font-semibold">{label}</div>
                    <div className="text-sm text-muted-foreground">{d}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Models per agent</div>
                {["foreman", ...agents].map((a) => (
                  <div key={a} className="grid grid-cols-[120px_1fr] items-center gap-3">
                    <span className="flex items-center gap-2 text-sm capitalize">
                      <AgentTypeIcon type={{ foreman: "FOREMAN", triage: "TRIAGE", spec: "SPEC", implement: "IMPLEMENT", review: "REVIEW" }[a]!} size="sm" />
                      {a === "implement" ? "Code" : a}
                    </span>
                    <ModelSelect value={models[a] ?? ""} onChange={(v) => setModels({ ...models, [a]: v })} harness="" />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Kiln is bring-your-own-keys: add the provider keys (or a Claude subscription token) under Secrets.</p>
              </div>
            </div>
          )}

          {mode === "wizard" && step === 6 && (
            <div className="mt-4 space-y-2">
              <p className="pb-2 text-base text-muted-foreground">Start with a few automations. They are files in the definition; edit or pause them any time.</p>
              {offered.length === 0 && <p className="text-sm text-muted-foreground">Connect a code host or tracker to see suggestions.</p>}
              {offered.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 hover:bg-muted/40">
                  <Checkbox className="mt-0.5" checked={chosenAutomations.includes(t.id)} onCheckedChange={(c) => setAutomations(c ? [...chosenAutomations, t.id] : chosenAutomations.filter((x) => x !== t.id))} />
                  <span>
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-sm text-muted-foreground">{t.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {mode === "wizard" && step === 7 && (
            <dl className="mt-6 divide-y rounded-xl border text-sm">
              {(
                [
                  ["Factory", `${name} (@${effectiveAlias})`, 1],
                  ["Code", forge === "none" ? "Custom setup commands" : `${FORGES.find((f) => f.id === forge)?.label}: ${repos.map((r) => `${r.owner}/${r.name}`).join(", ")}`, 0],
                  ["Agents", ["Foreman", ...agents.map((a) => AGENT_TOGGLES.find((t) => t.id === a)!.label)].join(", "), 2],
                  ["Communications", chat.map((c) => CHATS.find((x) => x.id === c.type)!.label).join(", ") || "None", 3],
                  ["Issue tracker", tracker ? `${tracker.type === "linear" ? "Linear" : "Jira"}${tracker.keys.length ? ` (${tracker.keys.join(", ")})` : ""}` : "None", 4],
                  ["Models", `${preset === "quality" ? "Higher quality" : "Cost-efficient"} · ${["foreman", ...agents].map((a) => `${a} ${modelLabel(models[a] ?? "")}`).join(", ")}`, 5],
                  ["Self-improvement", selfImprovement ? "On" : "Off", 5],
                  ["Automations", chosenAutomations.map((id) => offered.find((t) => t.id === id)?.name ?? id).join(", ") || "None", 6],
                ] as const
              ).map(([k, v, s]) => (
                <div key={k} className="grid grid-cols-[140px_1fr_auto] items-start gap-3 px-4 py-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                  <button type="button" onClick={() => setStep(s)} className="text-xs text-muted-foreground hover:text-foreground">
                    Edit
                  </button>
                </div>
              ))}
            </dl>
          )}

          {mode === "wizard" && step === 8 && (
            <div className="mt-4 space-y-6">
              <ul className="divide-y rounded-xl border">
                {checks === null && (
                  <li className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Testing connections…
                  </li>
                )}
                {checks?.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No integrations to test.</li>}
                {checks?.map((c) => (
                  <li key={c.type} className="flex items-center gap-3 px-4 py-3 text-sm">
                    {c.status === "ok" ? <CircleCheck className="size-4 text-emerald-500" /> : c.status === "missing" ? <CircleAlert className="size-4 text-amber-500" /> : <CircleX className="size-4 text-red-500" />}
                    <span className="font-medium capitalize">{c.label}</span>
                    <span className="ml-auto truncate text-muted-foreground">{c.detail}</span>
                    {c.status !== "ok" && (
                      <Link href={`/integrations?connect=${c.type}&return=/create`} className="text-xs font-medium hover:underline">
                        Connect
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <OptionCard>
                <div className="flex-1">
                  <div className="font-semibold">Enable learning</div>
                  <div className="text-sm text-muted-foreground">The factory researches how your repos, tracker and chat are set up and proposes memories and prompt tweaks for you to accept.</div>
                </div>
                <Switch checked={enableLearning} onCheckedChange={setEnableLearning} aria-label="Enable learning" />
              </OptionCard>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold" htmlFor="first-task">
                  Put your first task into the factory
                </label>
                <p className="text-sm text-muted-foreground">{tracker ? `Or assign a ${tracker.type === "linear" ? "Linear" : "Jira"} issue to the factory after it is created.` : "A small, well-defined change works best. The first line is the title."}</p>
                <Textarea id="first-task" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} rows={4} placeholder={"Fix the typo on the pricing page\n\nThe heading says “Pirce”."} />
              </div>
            </div>
          )}

          {mode === "wizard" && (
            <div className="mt-10 flex items-center justify-between gap-2">
              {step > 0 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={pending}>
                  <ArrowLeft /> Back
                </Button>
              ) : (
                <span />
              )}
              {step < STEPS.length - 1 ? (
                <Button className="h-10 px-5" onClick={next} disabled={!canNext} variant={canNext ? "default" : "secondary"}>
                  {step === 7 ? "Test connections" : "Next"}
                </Button>
              ) : (
                <Button className="h-10 px-5" onClick={create} disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <Check />} {firstTask.trim() ? "Create and start" : "Create factory"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <aside className="hidden flex-1 items-center justify-center bg-violet-200/70 p-12 lg:flex dark:bg-violet-950/40">
        <div className="flex w-full max-w-xl gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground text-lg font-bold text-background">K</span>
          <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm">
            <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5 text-sm">
              <span className="font-semibold">kiln-factory</span>
              <span className="rounded-full border px-1.5 text-xs text-muted-foreground">Bot</span>
              <span className="text-muted-foreground">commented 1h ago</span>
            </div>
            <div className="px-4 py-3 text-sm">
              <Markdown>{PREVIEW}</Markdown>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
