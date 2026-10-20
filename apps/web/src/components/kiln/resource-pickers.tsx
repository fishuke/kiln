"use client";

import { useMemo, useState, useTransition } from "react";
import { Bot, Cloud, Container, Eye, EyeOff, KeyRound, Laptop, Pencil, Plug, Plus, Search, Server, X } from "lucide-react";
import { toast } from "sonner";
import { createMcpServers, createTeamSecret } from "@/app/f/[factory]/settings/actions";
import { InfoTip } from "@/components/kiln/info-tip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HARNESSES, harnessLabel, hostOptions, modelLabel, modelsFor } from "@/lib/agent-catalog";
import { cn } from "@/lib/utils";

export const INHERIT = "__inherit";

export type SecretOption = { name: string; description?: string; type?: string };
export type McpOption = { name: string; description?: string; managed?: boolean };
export type RunnerOption = { name: string; os: string; description?: string };
export type WorkerOption = { id: string; name?: string };

export function DefaultBadge({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-px text-xs font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300", className)}>Default</span>;
}

/** Two-column form row: grey label column (with an optional "?" tooltip) and the control. */
export function FormRow({ label, tip, children, labelWidth = "sm:grid-cols-[144px_1fr]", align = "center" }: { label: string; tip?: string; children: React.ReactNode; labelWidth?: string; align?: "center" | "start" }) {
  return (
    <div className={cn("grid gap-2 sm:gap-6", labelWidth, align === "center" ? "sm:items-center" : "sm:items-start")}>
      <div className={cn("flex items-center gap-1.5 text-sm text-muted-foreground", align === "start" && "sm:pt-2.5")}>
        {label}
        {tip && <InfoTip title={label}>{tip}</InfoTip>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Chips({ items, icon: Icon, onRemove, disabled, empty = "--" }: { items: string[]; icon: React.ComponentType<{ className?: string }>; onRemove?: (name: string) => void; disabled?: boolean; empty?: string }) {
  if (!items.length && empty) return <span className="text-sm text-muted-foreground">{empty}</span>;
  return (
    <>
      {items.map((n) => (
        <span key={n} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background pr-1.5 pl-2.5 text-sm">
          <Icon className="size-4 text-muted-foreground" />
          {n}
          {onRemove && !disabled && (
            <button type="button" aria-label={`Remove ${n}`} onClick={() => onRemove(n)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
    </>
  );
}

const triggerCls = "h-10 w-full rounded-md bg-background px-3";

export function HarnessSelect({ value, onChange, inheritLabel, disabled }: { value: string; onChange: (v: string) => void; inheritLabel?: string; disabled?: boolean }) {
  const items: Record<string, React.ReactNode> = Object.fromEntries(HARNESSES.map((h) => [h.id, <HarnessItem key={h.id} label={h.label} />]));
  if (inheritLabel !== undefined) items[INHERIT] = <HarnessItem label={inheritLabel || "Factory default"} badge />;
  return (
    <Select items={items} value={value || INHERIT} onValueChange={(v) => onChange(v === INHERIT ? "" : String(v))} disabled={disabled}>
      <SelectTrigger className={triggerCls} aria-label="Harness">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {inheritLabel !== undefined && <SelectItem value={INHERIT}>{items[INHERIT]}</SelectItem>}
        {HARNESSES.map((h) => (
          <SelectItem key={h.id} value={h.id}>
            {items[h.id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function HarnessItem({ label, badge }: { label: string; badge?: boolean }) {
  return (
    <span className="flex w-full items-center gap-2">
      <Bot className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {badge && <DefaultBadge />}
    </span>
  );
}

export function ModelSelect({ value, onChange, harness, routers = [], inheritLabel, defaultModel, disabled, placeholder }: { value: string; onChange: (v: string) => void; harness: string; routers?: string[]; inheritLabel?: string; defaultModel?: string; disabled?: boolean; placeholder?: string }) {
  const options = modelsFor(harness, routers, value);
  const items: Record<string, React.ReactNode> = Object.fromEntries(
    options.map((m) => [
      m.id,
      <span key={m.id} className="flex w-full items-center gap-2">
        <span className="flex-1">{m.label}</span>
        {m.id === defaultModel && <DefaultBadge />}
      </span>,
    ]),
  );
  if (inheritLabel !== undefined) items[INHERIT] = (
    <span className="flex w-full items-center gap-2">
      <span className="flex-1 text-muted-foreground">{inheritLabel ? `${modelLabel(inheritLabel)} (inherited)` : placeholder ?? "Default"}</span>
    </span>
  );
  return (
    <Select items={items} value={value || INHERIT} onValueChange={(v) => onChange(v === INHERIT ? "" : String(v))} disabled={disabled}>
      <SelectTrigger className={triggerCls} aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {inheritLabel !== undefined && (
          <>
            <SelectItem value={INHERIT}>{items[INHERIT]}</SelectItem>
            <SelectSeparator />
          </>
        )}
        {options.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {items[m.id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const HOST_ICON = { local: Laptop, docker: Container, kubernetes: Cloud, worker: Server } as const;

export function HostSelect({ value, onChange, workers, defaultHost = "docker", inherit, disabled }: { value: string; onChange: (v: string) => void; workers: WorkerOption[]; defaultHost?: string; inherit?: boolean; disabled?: boolean }) {
  const hosts = hostOptions(workers);
  const items: Record<string, React.ReactNode> = Object.fromEntries(
    hosts.map((h) => {
      const Icon = HOST_ICON[h.kind];
      return [
        h.id,
        <span key={h.id} className="flex w-full items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="flex-1">{h.kind === "worker" ? `${h.label} (self-hosted worker)` : h.label}</span>
          {h.id === defaultHost && <DefaultBadge />}
        </span>,
      ];
    }),
  );
  if (inherit) items[INHERIT] = items[defaultHost] ?? defaultHost;
  return (
    <Select items={items} value={value || (inherit ? INHERIT : defaultHost)} onValueChange={(v) => onChange(v === INHERIT || v === defaultHost ? "" : String(v))} disabled={disabled}>
      <SelectTrigger className={triggerCls} aria-label="Host">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {hosts.map((h) => (
          <SelectItem key={h.id} value={inherit && h.id === defaultHost ? INHERIT : h.id}>
            {items[h.id]}
          </SelectItem>
        ))}
        {!workers.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">Register self-hosted workers with `kiln worker`.</div>}
      </SelectContent>
    </Select>
  );
}

/** Runner select: each row has an "Edit" pencil; "+ New runner" opens the runner dialog. */
export function RunnerSelect({ value, onChange, runners, defaultRunner, onEdit, onNew, inherit, disabled }: { value: string; onChange: (v: string) => void; runners: RunnerOption[]; defaultRunner?: string; onEdit: (name: string) => void; onNew: () => void; inherit?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = (r: RunnerOption) => (
    <span className="flex w-full items-center gap-2">
      <Server className="size-4 text-muted-foreground" />
      <span className="flex-1">{r.name}</span>
      {r.name === defaultRunner && <DefaultBadge />}
    </span>
  );
  const items: Record<string, React.ReactNode> = Object.fromEntries(runners.map((r) => [r.name, label(r)]));
  if (inherit) items[INHERIT] = defaultRunner && items[defaultRunner] ? items[defaultRunner] : <span className="text-muted-foreground">Factory default</span>;
  const current = value || (inherit ? INHERIT : (defaultRunner ?? ""));
  return (
    <Select items={items} value={current} open={open} onOpenChange={setOpen} onValueChange={(v) => onChange(v === INHERIT || (inherit && v === defaultRunner) ? "" : String(v))} disabled={disabled}>
      <SelectTrigger className={triggerCls} aria-label="Runner">
        <SelectValue placeholder="Select a runner" />
      </SelectTrigger>
      <SelectContent>
        {runners.map((r) => (
          <div key={r.name} className="flex items-center gap-1">
            <SelectItem value={inherit && r.name === defaultRunner ? INHERIT : r.name} className="flex-1">
              {items[r.name]}
            </SelectItem>
            <button
              type="button"
              aria-label={`Edit ${r.name}`}
              className="mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => {
                setOpen(false);
                onEdit(r.name);
              }}
            >
              <Pencil className="size-3.5" />
            </button>
          </div>
        ))}
        {!runners.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">No runners defined yet.</div>}
        <SelectSeparator />
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent"
          onClick={() => {
            setOpen(false);
            onNew();
          }}
        >
          <Plus className="size-4" /> New runner
        </button>
      </SelectContent>
    </Select>
  );
}

/** Two-pane "Add secret" dialog: pick team secrets on the left, or create one on the right. */
export function AddSecretDialog({ open, onOpenChange, secrets, selected, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; secrets: SecretOption[]; selected: string[]; onAdd: (names: string[]) => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", value: "", description: "" });
  const [show, setShow] = useState(false);
  const [pending, start] = useTransition();
  const available = secrets.filter((s) => !selected.includes(s.name));
  const shown = available.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  const close = () => {
    setPicked([]);
    setForm({ name: "", value: "", description: "" });
    onOpenChange(false);
  };
  const add = () => {
    if (form.name) {
      start(async () => {
        const r = await createTeamSecret(form);
        if (!r.ok) {
          toast.error(r.error ?? "Could not create the secret");
          return;
        }
        toast.success(`Secret ${form.name} created`);
        onAdd([...picked, form.name.trim()]);
        close();
      });
    } else {
      onAdd(picked);
      close();
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="h-[min(720px,90vh)] gap-0 overflow-hidden p-0 sm:max-w-[960px]" showCloseButton={false}>
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_1fr]">
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="relative border-b p-3">
              <Search className="absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search secrets" className="pl-8" aria-label="Search secrets" />
            </div>
            <button type="button" className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-sm font-medium">
              <Plus className="size-4" /> Add secret
            </button>
            <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Checkbox checked={shown.length > 0 && shown.every((s) => picked.includes(s.name))} onCheckedChange={(c) => setPicked(c ? shown.map((s) => s.name) : [])} disabled={!shown.length} />
                Select all
              </label>
              <span>
                {picked.length} of {available.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {shown.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">No secrets are available to add.</p>
              ) : (
                shown.map((s) => (
                  <label key={s.name} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
                    <Checkbox className="mt-0.5" checked={picked.includes(s.name)} onCheckedChange={(c) => setPicked((p) => (c ? [...p, s.name] : p.filter((x) => x !== s.name)))} />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm">{s.name}</span>
                      {s.description && <span className="block truncate text-xs text-muted-foreground">{s.description}</span>}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <DialogTitle>Add secret</DialogTitle>
              <div className="flex items-center gap-2">
                <Button onClick={add} disabled={pending || (!picked.length && !(form.name && form.value))}>
                  Add
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
                  <X />
                </Button>
              </div>
            </div>
            <div className="space-y-5 overflow-y-auto p-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="secret-name">
                  Name
                </label>
                <Input id="secret-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. OPENAI_API_KEY" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="secret-value">
                  Value
                </label>
                <div className="relative">
                  <Input id="secret-value" type={show ? "text" : "password"} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Enter secret value" className="pr-9" autoComplete="off" />
                  <button type="button" aria-label={show ? "Hide value" : "Show value"} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShow(!show)}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Values are encrypted at rest and never shown again. Agents receive them as environment variables.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="secret-desc">
                  Description (optional)
                </label>
                <Textarea id="secret-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Service account key for production" />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Two-pane "Add MCP" dialog: pick from the team MCP registry, or add custom configs as JSON. */
export function AddMcpDialog({ open, onOpenChange, servers, selected, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; servers: McpOption[]; selected: string[]; onAdd: (names: string[]) => void }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<string>("custom");
  const [json, setJson] = useState("");
  const [pending, start] = useTransition();
  const available = useMemo(() => servers.filter((s) => !selected.includes(s.name) && s.name.toLowerCase().includes(q.toLowerCase())), [servers, selected, q]);
  const pickedServer = servers.find((s) => s.name === mode);
  const close = () => {
    setJson("");
    setMode("custom");
    onOpenChange(false);
  };
  const add = () => {
    if (pickedServer) {
      onAdd([pickedServer.name]);
      close();
      return;
    }
    let parsed: Record<string, Record<string, unknown>>;
    try {
      const v = JSON.parse(json) as Record<string, unknown>;
      const single = typeof v.url === "string" || typeof v.command === "string";
      parsed = single ? { [String(v.name ?? "custom-mcp")]: v } : (v as Record<string, Record<string, unknown>>);
      if (!Object.keys(parsed).length) throw new Error("empty");
    } catch {
      toast.error("Enter a JSON object of MCP configs keyed by name.");
      return;
    }
    start(async () => {
      const r = await createMcpServers(parsed);
      if (!r.ok) {
        toast.error(r.error ?? "Could not add the MCP server");
        return;
      }
      onAdd(r.names);
      close();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="h-[min(720px,90vh)] gap-0 overflow-hidden p-0 sm:max-w-[780px]" showCloseButton={false}>
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_1fr]">
          <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
            <div className="relative border-b p-3">
              <Search className="absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps and MCP servers" className="pl-8" aria-label="Search apps and MCP servers" />
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
              <button type="button" onClick={() => setMode("custom")} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm", mode === "custom" ? "bg-muted font-medium" : "hover:bg-muted")}>
                <Plus className="size-4" /> Custom MCP
              </button>
              {available.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">No connected MCP servers are available to add.</p>
              ) : (
                available.map((s) => (
                  <button key={s.name} type="button" onClick={() => setMode(s.name)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm", mode === s.name ? "bg-muted font-medium" : "hover:bg-muted")}>
                    <Plug className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <DialogTitle>{pickedServer ? pickedServer.name : "Add custom MCP"}</DialogTitle>
              <div className="flex items-center gap-2">
                <Button onClick={add} disabled={pending || (!pickedServer && !json.trim())}>
                  Add
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}>
                  <X />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
              {pickedServer ? (
                <p className="text-sm text-muted-foreground">{pickedServer.description ?? "An MCP server from your team registry."}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Add one or more MCP configs as JSON, keyed by MCP name. A single config without a name is also supported. Use <code className="rounded bg-muted px-1 font-mono text-xs">{"{{secret_name}}"}</code> to reference a managed secret attached to this agent.
                  </p>
                  <label className="text-sm font-medium" htmlFor="mcp-json">
                    Configuration
                  </label>
                  <Textarea
                    id="mcp-json"
                    value={json}
                    onChange={(e) => setJson(e.target.value)}
                    className="min-h-60 flex-1 font-mono text-xs"
                    placeholder={'{\n  "sentry": {\n    "url": "https://mcp.sentry.dev/mcp",\n    "headers": { "Authorization": "Bearer {{SENTRY_TOKEN}}" }\n  }\n}'}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Harness auth secret: a team secret name, e.g. CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY. */
export function AuthSecretField({ harness, value, onChange, secrets, disabled }: { harness: string; value: string; onChange: (v: string) => void; secrets: SecretOption[]; disabled?: boolean }) {
  const hint = HARNESSES.find((h) => h.id === harness)?.authHint;
  const listId = `auth-secrets-${harness}`;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={harness === "claude-code" ? "CLAUDE_CODE_OAUTH_TOKEN" : "Secret name"} className="h-10 pl-9 font-mono" disabled={disabled} aria-label={`${harnessLabel(harness)} auth secret`} />
        <datalist id={listId}>
          {secrets.map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint} Leave empty to use the worker&apos;s own credentials.</p>}
    </div>
  );
}
