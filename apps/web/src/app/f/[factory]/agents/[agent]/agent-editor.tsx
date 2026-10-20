"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Copy, CopyPlus, EllipsisVertical, GitPullRequestArrow, KeyRound, Plug, Plus, RotateCcw, Trash, Zap } from "lucide-react";
import { toast } from "sonner";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { MarkdownEditor } from "@/components/kiln/markdown-editor";
import { AddMcpDialog, AddSecretDialog, AuthSecretField, Chips, FormRow, HarnessSelect, HostSelect, ModelSelect, RunnerSelect, type McpOption, type RunnerOption, type SecretOption, type WorkerOption } from "@/components/kiln/resource-pickers";
import { RunnerDialog, type RunnerFile } from "@/components/kiln/runner-dialog";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { AgentForm } from "@/lib/agent-file";
import { harnessLabel } from "@/lib/agent-catalog";
import { cn } from "@/lib/utils";
import { deleteAgent, duplicateAgent, saveAgent } from "../actions";

export type AutomationRow = { name: string; title: string; triggers: string; enabled: boolean };

type Props = {
  factory: string;
  factoryName: string;
  name: string | null;
  title: string;
  initial: AgentForm;
  defaults: { harness: string; model: string; runner: string; host: string };
  runners: RunnerOption[];
  runnerFiles: Record<string, RunnerFile>;
  routers: string[];
  secrets: SecretOption[];
  mcps: McpOption[];
  workers: WorkerOption[];
  automations: AutomationRow[];
  otherAgents: { name: string; title: string }[];
  readOnly: boolean;
  repo?: string;
  initialTab?: Tab;
};

type Tab = "prompt" | "automations" | "settings";

function prToast(url: string) {
  toast.success("Pull request opened", { description: url, action: { label: "View", onClick: () => window.open(url, "_blank") } });
}

export function AgentEditor(p: Props) {
  const router = useRouter();
  const isNew = p.name === null;
  const [form, setForm] = useState<AgentForm>(p.initial);
  const [newName, setNewName] = useState("");
  const [tab, setTab] = useState<Tab>(p.initialTab ?? (isNew ? "settings" : "settings"));
  const [dialog, setDialog] = useState<null | "mcp" | "secret" | "delete">(null);
  const [runnerDialog, setRunnerDialog] = useState<{ open: boolean; name?: string }>({ open: false });
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(p.initial) || (isNew && !!newName), [form, p.initial, isNew, newName]);
  const set = (patch: Partial<AgentForm>) => setForm((f) => ({ ...f, ...patch }));
  const ro = p.readOnly;
  const harness = form.harness || p.defaults.harness;

  const save = () =>
    start(async () => {
      const r = await saveAgent(p.factory, isNew ? newName : p.name!, form, isNew);
      if (!r.ok) {
        toast.error(r.error, { description: r.errors?.slice(1, 4).join("\n") });
        return;
      }
      if (r.pullRequest) prToast(r.pullRequest);
      else toast.success(isNew ? "Agent created" : "Agent saved");
      if (isNew && r.name && !r.pullRequest) router.push(`/f/${p.factory}/agents/${r.name}`);
      else router.refresh();
    });

  const actions = (
    <>
      {!isNew && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(p.name!).then(() => toast.success("Agent name copied"))}>
              <Copy /> Copy agent name
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(`agents/${p.name}/agent.md`).then(() => toast.success("File path copied"))}>
              <Copy /> Copy file path
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={ro}
              onClick={() =>
                start(async () => {
                  const r = await duplicateAgent(p.factory, p.name!);
                  if (!r.ok) return void toast.error(r.error);
                  if (r.pullRequest) prToast(r.pullRequest);
                  else {
                    toast.success(`Duplicated as ${r.name}`);
                    router.push(`/f/${p.factory}/agents/${r.name}`);
                  }
                })
              }
            >
              <CopyPlus /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!dirty} onClick={() => setForm(p.initial)}>
              <RotateCcw /> Restore defaults
            </DropdownMenuItem>
            {form.agentType !== "FOREMAN" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={ro} onClick={() => setDialog("delete")}>
                  <Trash /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button onClick={save} disabled={ro || pending || !dirty || (isNew && !newName.trim())} variant={dirty ? "default" : "secondary"}>
        {p.repo && !ro ? <GitPullRequestArrow /> : null}
        {pending ? "Saving…" : isNew ? "Create agent" : "Save"}
      </Button>
    </>
  );

  return (
    <>
      <PageHeader crumbs={[{ label: p.factoryName, href: `/f/${p.factory}/dashboard` }, { label: "Agents", href: `/f/${p.factory}/agents` }, { label: isNew ? "New agent" : p.title }]} actions={actions} />
      {p.repo && (
        <div className={cn("border-b px-6 py-2 text-sm", ro ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-muted/50 text-muted-foreground")}>
          {ro ? (
            <>
              This factory&apos;s definition lives in <span className="font-medium">{p.repo}</span>. It is read-only here; change agents/{p.name ?? "<name>"}/agent.md in the repository.
            </>
          ) : (
            <>
              This factory&apos;s definition lives in <span className="font-medium">{p.repo}</span>. Saving opens a pull request.
            </>
          )}
        </div>
      )}
      <div className="mx-auto w-full max-w-[704px] px-4 pt-8 pb-16 sm:px-4">
        <AgentTypeIcon type={form.agentType} />
        {isNew ? (
          <div className="mt-3 space-y-1">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Agent name, e.g. mobile-build" aria-label="Agent name" className="h-11 text-lg font-semibold" disabled={ro} />
            <p className="text-xs text-muted-foreground">Agent names cannot be changed after creation. The name is the folder under agents/.</p>
          </div>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{p.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">Agent names cannot be changed after creation.</p>
          </>
        )}
        <div className="mt-6 flex gap-1" role="tablist">
          {(["prompt", "automations", "settings"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>

        {tab === "prompt" && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Agent prompt</h2>
            <p className="mb-3 text-sm text-muted-foreground">This is the base prompt the agent will use.</p>
            <MarkdownEditor value={form.prompt} onChange={(v) => set({ prompt: v })} disabled={ro} placeholder={"# Role\n\nYou are…"} />
          </section>
        )}

        {tab === "automations" && (
          <section className="mt-8">
            {p.automations.length === 0 ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
                <div className="font-semibold">No automations yet</div>
                <p className="mt-1 text-sm text-muted-foreground">Automations using this Agent will appear here.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button render={<Link href={`/f/${p.factory}/automations`} />} nativeButton={false}>
                    View automations
                  </Button>
                  {!isNew && (
                    <Button variant="outline" render={<Link href={`/f/${p.factory}/automations/new?agent=${p.name}`} />} nativeButton={false}>
                      <Plus /> New automation
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <ul className="rounded-lg border py-2">
                  {p.automations.map((a) => (
                    <li key={a.name}>
                      <Link href={`/f/${p.factory}/automations/${a.name}`} aria-label={`Open automation ${a.title}`} className="flex h-9 items-center gap-3 px-4 text-sm hover:bg-muted/50">
                        <Zap className={cn("size-4 shrink-0", a.enabled ? "text-amber-500" : "text-muted-foreground")} />
                        <span className="truncate font-semibold">{a.title}</span>
                        <span className="ml-auto truncate text-muted-foreground">{a.enabled ? a.triggers : "Paused"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" className="mt-3" render={<Link href={`/f/${p.factory}/automations/new?agent=${p.name}`} />} nativeButton={false}>
                  <Plus /> New automation
                </Button>
              </>
            )}
          </section>
        )}

        {tab === "settings" && (
          <fieldset disabled={ro} className="mt-8 space-y-10">
            <section>
              <h2 className="text-lg font-semibold">Description</h2>
              <p className="mb-3 text-sm text-muted-foreground">Summarize what this agent is responsible for.</p>
              <Input value={form.description} onChange={(e) => set({ description: e.target.value })} className="h-10" aria-label="Description" placeholder="e.g. Builds and signs the iOS app" />
            </section>
            <section>
              <h2 className="text-lg font-semibold">Agent resources</h2>
              <p className="text-sm text-muted-foreground">Configure this agent’s tools, credentials, and runtime.</p>
              <Link href={`/f/${p.factory}/settings#agent-defaults`} className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
                View defaults
              </Link>
              <div className="mt-5 space-y-4">
                <FormRow label="MCPs" tip="MCP servers this agent can call. Set here, they replace the factory defaults for this agent.">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chips items={form.mcpServers ?? []} icon={Plug} empty={form.mcpServers === null ? "" : "--"} onRemove={(n) => set({ mcpServers: (form.mcpServers ?? []).filter((x) => x !== n) })} />
                    <Button variant="ghost" onClick={() => setDialog("mcp")}>
                      <Plus /> Add MCP
                    </Button>
                    {form.mcpServers !== null && (
                      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ mcpServers: null })}>
                        Use defaults
                      </button>
                    )}
                  </div>
                </FormRow>
                <FormRow label="Secrets" tip="Team secrets passed to this agent's runs as environment variables. Set here, they replace the factory defaults.">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chips items={form.secrets ?? []} icon={KeyRound} empty={form.secrets === null ? "" : "--"} onRemove={(n) => set({ secrets: (form.secrets ?? []).filter((x) => x !== n) })} />
                    <Button variant="ghost" onClick={() => setDialog("secret")}>
                      <Plus /> Add secret
                    </Button>
                    {form.secrets !== null && (
                      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ secrets: null })}>
                        Use defaults
                      </button>
                    )}
                  </div>
                </FormRow>
                <FormRow label="Harness" tip="The agent framework that runs the prompt. This also affects which models are available.">
                  <HarnessSelect value={form.harness} onChange={(v) => set({ harness: v, authSecret: v ? form.authSecret : "" })} inheritLabel={p.defaults.harness ? harnessLabel(p.defaults.harness) : ""} disabled={ro} />
                </FormRow>
                {form.harness && (
                  <FormRow label="Auth" tip="The team secret the harness authenticates with: an API key, or a Claude subscription token (CLAUDE_CODE_OAUTH_TOKEN).">
                    <AuthSecretField harness={form.harness} value={form.authSecret} onChange={(v) => set({ authSecret: v })} secrets={p.secrets} disabled={ro} />
                  </FormRow>
                )}
                <FormRow label="Model" tip="The model the agent runs on. The available options depend on the selected harness.">
                  <ModelSelect value={form.model} onChange={(v) => set({ model: v })} harness={harness} routers={p.routers} inheritLabel={p.defaults.model} defaultModel={p.defaults.model} disabled={ro} />
                </FormRow>
                <FormRow label="Host" tip="Where runs execute: on this Kiln server (Local), in Docker or Kubernetes, or on one of your own self-hosted workers.">
                  <HostSelect value={form.host} onChange={(v) => set({ host: v })} workers={p.workers} defaultHost={p.defaults.host} inherit disabled={ro} />
                </FormRow>
                <FormRow label="Runner" tip="A runner describes the sandbox configuration requested for a run (its OS, image, CPU, and memory). These settings act as constraints where supported by the selected host.">
                  <RunnerSelect value={form.runner} onChange={(v) => set({ runner: v })} runners={p.runners} defaultRunner={p.defaults.runner} inherit onEdit={(n) => setRunnerDialog({ open: true, name: n })} onNew={() => setRunnerDialog({ open: true })} disabled={ro} />
                </FormRow>
                <FormRow label="Spawnable by" tip="Which agents may start this agent as a subagent. By default only the foreman can.">
                  <SpawnablePicker value={form.spawnableBy} onChange={(v) => set({ spawnableBy: v })} agents={p.otherAgents} disabled={ro} />
                </FormRow>
                <FormRow label="Idle timeout" tip="Minutes a finished session stays alive for follow-ups (1–60). Empty uses the default of 10 minutes.">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={form.idleTimeoutMinutes ?? ""}
                      placeholder="10"
                      onChange={(e) => set({ idleTimeoutMinutes: e.target.value === "" ? null : Math.min(60, Math.max(1, Number(e.target.value))) })}
                      className="h-10 w-24"
                      aria-label="Idle timeout in minutes"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                </FormRow>
                <FormRow label="Computer use" tip="Lets the agent take screenshots and record videos of a browser or desktop to verify UI changes.">
                  <Switch checked={form.computerUse} onCheckedChange={(c) => set({ computerUse: c })} aria-label="Computer use" />
                </FormRow>
              </div>
            </section>
          </fieldset>
        )}
      </div>

      <AddMcpDialog open={dialog === "mcp"} onOpenChange={(o) => setDialog(o ? "mcp" : null)} servers={p.mcps} selected={form.mcpServers ?? []} onAdd={(n) => set({ mcpServers: [...new Set([...(form.mcpServers ?? []), ...n])] })} />
      <AddSecretDialog open={dialog === "secret"} onOpenChange={(o) => setDialog(o ? "secret" : null)} secrets={p.secrets} selected={form.secrets ?? []} onAdd={(n) => set({ secrets: [...new Set([...(form.secrets ?? []), ...n])] })} />
      <RunnerDialog
        factory={p.factory}
        open={runnerDialog.open}
        onOpenChange={(o) => setRunnerDialog((s) => ({ ...s, open: o }))}
        name={runnerDialog.name}
        runner={runnerDialog.name ? p.runnerFiles[runnerDialog.name] : undefined}
        isDefault={!!runnerDialog.name && runnerDialog.name === p.defaults.runner}
        secrets={p.secrets}
        readOnly={ro}
        onSaved={(n) => {
          if (!runnerDialog.name) set({ runner: n });
          router.refresh();
        }}
      />
      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.title}?</AlertDialogTitle>
            <AlertDialogDescription>This removes agents/{p.name}/ from the factory definition. Automations that target this agent stop working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteAgent(p.factory, p.name!);
                  setDialog(null);
                  if (!r.ok) return void toast.error(r.error);
                  if (r.pullRequest) prToast(r.pullRequest);
                  else toast.success(`${p.title} deleted`);
                  router.push(`/f/${p.factory}/agents`);
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SpawnablePicker({ value, onChange, agents, disabled }: { value: string[] | null; onChange: (v: string[] | null) => void; agents: { name: string; title: string }[]; disabled?: boolean }) {
  const label = value === null ? "Foreman only (default)" : value.length === 0 ? "No agent" : agents.filter((a) => value.includes(a.name)).map((a) => a.title).join(", ") || value.join(", ");
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="h-10 w-full justify-between font-normal" disabled={disabled} />}>
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <button type="button" className={cn("flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", value === null && "font-medium")} onClick={() => onChange(null)}>
          Foreman only (default)
        </button>
        <button type="button" className={cn("flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", value?.length === 0 && "font-medium")} onClick={() => onChange([])}>
          No agent
        </button>
        <div className="my-1 h-px bg-border" />
        {agents.map((a) => (
          <label key={a.name} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={!!value?.includes(a.name)} onCheckedChange={(c) => onChange(c ? [...(value ?? []), a.name] : (value ?? []).filter((x) => x !== a.name))} />
            {a.title}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
