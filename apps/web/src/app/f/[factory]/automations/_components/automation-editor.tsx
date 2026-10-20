"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { EllipsisVertical, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { Field, TokenPicker } from "@/components/kiln/form-controls";
import { MarkdownEditor } from "@/components/kiln/markdown-editor";
import { PillTabs } from "@/components/kiln/pill-tabs";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Resources } from "@/lib/api/resources";
import { hasScheduleTrigger, type AutomationModel, type Overrides } from "@/lib/automations/model";
import { cn } from "@/lib/utils";
import { toastResult } from "@/lib/toast-result";
import { deleteAutomation, runAutomationNow, saveAutomation, setAutomationEnabled } from "../actions";
import { RunsTable, type RunRow } from "./runs-table";
import { TestFilterDialog } from "./test-filter-dialog";
import { TriggersCard, type TriggerContext } from "./trigger-editor";

const INHERIT = "__inherit__";

function OverrideSelect({ label, value, options, onChange, inheritLabel }: { label: string; value: string | undefined; options: string[]; onChange: (v: string | undefined) => void; inheritLabel: string }) {
  const items = [...new Set([...(value ? [value] : []), ...options])];
  return (
    <Select value={value ?? INHERIT} onValueChange={(v) => onChange(v === INHERIT || v === null ? undefined : String(v))}>
      <SelectTrigger aria-label={label} className="h-9 w-full">
        <SelectValue>{(v: string) => (v === INHERIT ? <span className="text-muted-foreground">{inheritLabel}</span> : v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {items.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Model, harness, runner, secrets, MCP servers and host for runs this automation starts. */
function ExecutionOverrides({ overrides, onChange, res }: { overrides: Overrides; onChange: (o: Overrides) => void; res: Resources }) {
  const set = (k: keyof Overrides, v: unknown) => {
    const next = { ...overrides };
    if (v === undefined || (Array.isArray(v) && !v.length) || v === "") delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const harness = overrides.harness as { type?: string; model?: string } | null | undefined;
  const count = Object.keys(overrides).length;
  const [open, setOpen] = useState(count > 0);
  return (
    <section>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground">
        <span>
          Execution overrides{count > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground">{count}</span>}
        </span>
        <span className="text-xs">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
          <p className="text-xs text-muted-foreground sm:col-span-2">Values left empty come from the agent, then from the factory's agent defaults. Secrets and MCP servers set here replace the inherited list.</p>
          <Field label="Model">
            <OverrideSelect label="Model" value={typeof overrides.model === "string" ? overrides.model : undefined} options={res.models} onChange={(v) => set("model", v)} inheritLabel="From agent" />
          </Field>
          <Field label="Harness">
            <OverrideSelect label="Harness" value={harness?.type} options={res.harnesses} onChange={(v) => set("harness", v ? { ...(harness ?? {}), type: v } : undefined)} inheritLabel="From agent" />
          </Field>
          <Field label="Runner">
            <OverrideSelect label="Runner" value={typeof overrides.runner === "string" ? overrides.runner : undefined} options={res.runners} onChange={(v) => set("runner", v)} inheritLabel="From agent" />
          </Field>
          <Field label="Host" help="Kiln managed, or the name of a self-hosted worker.">
            <input
              aria-label="Host"
              defaultValue={typeof overrides.workerHost === "string" ? overrides.workerHost : ""}
              onBlur={(e) => set("workerHost", e.target.value.trim() || undefined)}
              placeholder="Kiln managed"
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Field>
          <Field label="Secrets" className="sm:col-span-2">
            <TokenPicker label="Secrets" values={asStrings(overrides.secrets)} onChange={(v) => set("secrets", v)} suggestions={res.secrets} placeholder="From agent" />
          </Field>
          <Field label="MCP servers" className="sm:col-span-2">
            <TokenPicker label="MCP servers" values={asStrings(overrides.mcpServers)} onChange={(v) => set("mcpServers", v)} suggestions={res.mcpServers.map((m) => ({ value: m.name, label: m.name }))} placeholder="From agent" />
          </Field>
          <Field label="Extra repositories" help="Prepared for every run, in addition to the agent's own." className="sm:col-span-2">
            <TokenPicker label="Extra repositories" values={asStrings(overrides.required_repos)} onChange={(v) => set("required_repos", v)} suggestions={res.repositories} placeholder="owner/name" validate={(x) => (/^[^/\s]+\/[^/\s]+$/.test(x) ? null : "Use owner/name")} />
          </Field>
        </div>
      )}
    </section>
  );
}

export type EditorProps = {
  factory: string;
  factoryName: string;
  /** Saved automation name; null for a new automation. */
  original: string | null;
  initial: AutomationModel;
  resources: Resources;
  webhooks: { uid: string; name: string }[];
  connected: string[];
  alias: string;
  runs: RunRow[];
  repoBacked: boolean;
  prefilled?: boolean;
};

export function AutomationEditor(p: EditorProps) {
  const router = useRouter();
  const [model, setModel] = useState(p.initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(p.initial));
  const [tab, setTab] = useState<"settings" | "runs">("settings");
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const isNew = p.original === null;
  const dirty = JSON.stringify(model) !== baseline || (isNew && p.prefilled === true);
  const title = isNew ? model.name : model.displayName || model.name;
  const nameError = isNew && touched && !model.name.trim() ? "Name is required." : null;
  const valid = model.triggers.length > 0 && (!isNew || model.name.trim().length > 0);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const ctx: TriggerContext = useMemo(
    () => ({ factory: p.factory, repositories: p.resources.repositories, webhooks: p.webhooks, connected: p.connected, alias: p.alias, savedName: p.original ?? undefined, onTestFilter: setTesting }),
    [p.factory, p.resources.repositories, p.webhooks, p.connected, p.alias, p.original],
  );

  const save = () => {
    setTouched(true);
    if (!valid) {
      toast.error(model.triggers.length ? "Name is required." : "Add at least one trigger.");
      return;
    }
    start(async () => {
      const r = await saveAutomation(p.factory, p.original, model);
      if (!toastResult(r, isNew ? "Automation created" : "Automation saved")) return;
      setBaseline(JSON.stringify(model));
      if (isNew && r.ok && r.name && !r.pullRequest) router.push(`/f/${p.factory}/automations/${encodeURIComponent(r.name)}`);
      else router.refresh();
    });
  };

  const togglePause = () => {
    if (isNew) return setModel((m) => ({ ...m, enabled: !m.enabled }));
    const enabled = !model.enabled;
    start(async () => {
      if (!toastResult(await setAutomationEnabled(p.factory, p.original!, enabled), enabled ? "Automation resumed" : "Automation paused")) return;
      setModel((m) => ({ ...m, enabled }));
      setBaseline((b) => JSON.stringify({ ...JSON.parse(b), enabled }));
      router.refresh();
    });
  };

  const runNow = () =>
    start(async () => {
      const r = await runAutomationNow(p.factory, p.original!);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.fallback ? "Prompt sent to the factory" : "Automation started", r.href ? { action: { label: "View run", onClick: () => router.push(r.href!) } } : undefined);
    });

  const canRun = !isNew && hasScheduleTrigger(model);
  const agentOptions = p.resources.agents;
  const foreman = agentOptions.find((a) => a.agentType === "FOREMAN")?.name;
  const agentValue = model.agent ?? foreman ?? "";

  return (
    <>
      <PageHeader
        crumbs={[{ label: p.factoryName, href: `/f/${p.factory}/dashboard` }, { label: "Automations", href: `/f/${p.factory}/automations` }, { label: title || "New Automation" }]}
        actions={
          <>
            {isNew ? (
              <Link href={`/f/${p.factory}/automations`} className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
                  <EllipsisVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => (setRenaming(true), setTimeout(() => titleRef.current?.focus(), 0))}>
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={togglePause}>
                    {model.enabled ? <Pause /> : <Play />} {model.enabled ? "Pause" : "Resume"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Tooltip>
              <TooltipTrigger render={<span />}>
                <Button variant="secondary" size="icon" aria-label="Run now" disabled={!canRun || pending} onClick={runNow}>
                  <Play />
                </Button>
              </TooltipTrigger>
              {!canRun && (
                <TooltipContent className="max-w-60">
                  {isNew ? (
                    <>
                      <b>Save required</b>: Save this automation before running it.
                    </>
                  ) : (
                    <>
                      <b>No cron trigger</b>: Add a schedule trigger to this automation to run it now.
                    </>
                  )}
                </TooltipContent>
              )}
            </Tooltip>
            <Button onClick={save} disabled={pending || !dirty} variant={dirty && valid ? "default" : "secondary"}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-[820px] px-6 py-10">
        {isNew || renaming ? (
          <input
            ref={titleRef}
            autoFocus={isNew && !p.prefilled}
            aria-label="Automation name"
            value={isNew ? model.name : (model.displayName ?? model.name)}
            onChange={(e) => setModel((m) => (isNew ? { ...m, name: e.target.value } : { ...m, displayName: e.target.value }))}
            onBlur={() => (setRenaming(false), setTouched(true))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="Enter Automation Name"
            className="w-full bg-transparent text-[28px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70"
          />
        ) : (
          <h1>
            <button type="button" aria-label="Rename automation" onClick={() => setRenaming(true)} className="text-left text-[28px] leading-tight font-semibold tracking-tight hover:opacity-80">
              {title}
            </button>
          </h1>
        )}
        {nameError && <p className="mt-1 text-sm text-destructive">{nameError}</p>}
        {!isNew && (
          <div className="mt-4 flex items-center justify-between">
            <span className={cn("rounded-full border px-2.5 py-0.5 text-sm font-medium", model.enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400")}>
              {model.enabled ? "Unpaused" : "Paused"}
            </span>
            <Button variant="outline" onClick={togglePause} disabled={pending}>
              {model.enabled ? "Pause" : "Resume"}
            </Button>
          </div>
        )}
        {p.repoBacked && <p className="mt-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">This factory is defined in a repository. Saving opens a pull request with the change.</p>}
        <div className="mt-6 mb-6">
          <PillTabs
            tabs={[
              { id: "settings", label: "Settings" },
              { id: "runs", label: "Runs" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {tab === "settings" ? (
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm text-muted-foreground">Triggers</h2>
              <TriggersCard triggers={model.triggers} onChange={(triggers) => setModel((m) => ({ ...m, triggers }))} ctx={ctx} />
            </section>
            <section>
              <h2 className="mb-2 text-sm text-muted-foreground">Agents</h2>
              <Select
                value={agentValue}
                onValueChange={(v) => {
                  if (v === "__new__") return router.push(`/f/${p.factory}/agents/new`);
                  setModel((m) => ({ ...m, agent: v === foreman && !m.agent ? undefined : String(v) }));
                }}
              >
                <SelectTrigger aria-label="Agent" className="h-10 w-full text-base">
                  <SelectValue>
                    {(v: string) => {
                      const a = agentOptions.find((x) => x.name === v);
                      return v ? (
                        <span className="flex items-center gap-2">
                          <AgentTypeIcon type={a?.agentType} /> {v}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Choose an agent</span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {agentOptions.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      <AgentTypeIcon type={a.agentType} /> {a.name}
                    </SelectItem>
                  ))}
                  {model.agent && !agentOptions.some((a) => a.name === model.agent) && <SelectItem value={model.agent}>{model.agent}</SelectItem>}
                  <SelectItem value="__new__">New agent</SelectItem>
                </SelectContent>
              </Select>
            </section>
            <section>
              <h2 className="mb-2 text-sm text-muted-foreground">Agent prompt</h2>
              <MarkdownEditor label="Agent prompt" value={model.prompt} onChange={(prompt) => setModel((m) => ({ ...m, prompt }))} placeholder="Add an additional prompt alongside the default agent prompt(s)." />
            </section>
            <ExecutionOverrides overrides={model.overrides} onChange={(overrides) => setModel((m) => ({ ...m, overrides }))} res={p.resources} />
          </div>
        ) : (
          <RunsTable rows={p.runs} empty={isNew ? "Save this automation to see its runs." : "This automation has not started any runs yet."} />
        )}
      </div>
      {!isNew && <TestFilterDialog factory={p.factory} name={p.original!} trigger={testing === null ? null : (model.triggers[testing] ?? null)} onClose={() => setTesting(null)} />}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the automation from the factory definition. Runs it already started keep going.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                start(async () => {
                  if (toastResult(await deleteAutomation(p.factory, p.original!), "Automation deleted")) {
                    setBaseline(JSON.stringify(model));
                    router.push(`/f/${p.factory}/automations`);
                  }
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
