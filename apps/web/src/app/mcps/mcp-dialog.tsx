"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Database, Globe, Search, Settings, Terminal, Theater, X } from "lucide-react";
import type { McpServer } from "@kiln/sdk-ts";
import { FigmaIcon } from "@/components/kiln/mcp-icons";
import { GitHubIcon, LinearIcon, SentryIcon } from "@/components/kiln/brand-icons";
import { McpFields, useMcpFields } from "@/components/kiln/mcp-fields";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CUSTOM_SUGGESTION,
  fillTemplate,
  MCP_TEMPLATES,
  parseMcpJson,
  secretRefs,
  toMcpJson,
  toMcpName,
  type McpTemplate,
  type ParsedMcp,
} from "@/lib/mcp-config";
import { cn } from "@/lib/utils";
import { createMcp, updateMcp } from "./actions";

export const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  github: GitHubIcon,
  linear: LinearIcon,
  sentry: SentryIcon,
  figma: FigmaIcon,
  playwright: Theater,
  postgres: Database,
  "custom-stdio": Terminal,
  "custom-url": Globe,
  signoz: Activity,
  datadog: Activity,
  newrelic: Activity,
  betterstack: Activity,
};

export function McpIcon({ id, className }: { id?: string; className?: string }) {
  const I = (id && TEMPLATE_ICONS[id]) || Settings;
  return <I className={className} />;
}

type Builtin = { kiln_id: string; description: string; connected: boolean; missing: string[] };

/** "Add MCP server": templates on the left, the config on the right. With `server`, edits it. */
export function McpDialog({ open, onOpenChange, secrets, builtins, server }: { open: boolean; onOpenChange: (o: boolean) => void; secrets: string[]; builtins: Builtin[]; server?: McpServer }) {
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState<McpTemplate | "custom">("custom");
  const [display, setDisplay] = useState(server?.name ?? "");
  const [config, setConfig] = useState(server ? toMcpJson(server.name, server) : "");
  const [mode, setMode] = useState<"managed" | "direct">(server?.mode ?? "managed");
  const [modeTouched, setModeTouched] = useState(Boolean(server));
  const [description, setDescription] = useState(server?.description ?? "");
  const [showJson, setShowJson] = useState(false);
  const [pending, run] = useAction();
  const router = useRouter();

  const t = template === "custom" ? undefined : template;
  // A template with fields is filled in through its form; its JSON stays available for edits.
  const guided = Boolean(t?.fields?.length) && !showJson;
  const form = useMcpFields(guided ? t!.fields! : [], undefined, t?.name);
  const parsed = useMemo(
    () => (guided ? ({ ok: true, name: undefined, server: fillTemplate(t!.server, t!.fields!, form.values) } as ParsedMcp) : parseMcpJson(config)),
    [guided, t, form.values, config],
  );
  const name = toMcpName(display || (parsed.ok ? (parsed.name ?? "") : ""));
  const refs = parsed.ok ? secretRefs(parsed.server) : [];
  const effectiveMode = modeTouched ? mode : parsed.ok && parsed.server.command ? "direct" : "managed";
  const valid = parsed.ok && name.length > 0 && (!guided || form.ready);
  const shown = MCP_TEMPLATES.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));

  const pick = (t: McpTemplate | "custom") => {
    setTemplate(t);
    setShowJson(false);
    form.reset();
    if (t === "custom") {
      setDisplay("");
      setConfig("");
      setDescription("");
      setModeTouched(false);
      return;
    }
    const builtin = builtins.some((b) => b.kiln_id === t.id);
    const n = builtin ? `${t.id}-team` : t.id.startsWith("custom") ? "" : t.id;
    setDisplay(t.id.startsWith("custom") ? "" : t.name);
    setConfig(toMcpJson(n || "server-name", t.server));
    setDescription(t.id.startsWith("custom") ? "" : t.description);
    setMode(t.mode);
    setModeTouched(true);
  };

  const reset = () => {
    pick("custom");
    setQuery("");
  };

  const submit = () => {
    if (!parsed.ok) return;
    const shape = parsed.server.url ? { url: parsed.server.url, headers: parsed.server.headers ?? {} } : { command: parsed.server.command, args: parsed.server.args ?? [], env: parsed.server.env ?? {} };
    const body = { name, description: description.trim() || undefined, mode: effectiveMode, ...shape };
    const done = {
      onSuccess: () => {
        onOpenChange(false);
        if (!server) reset();
        router.refresh();
      },
    };
    if (server) return run(() => updateMcp(server.id, body), done);
    if (guided)
      return run(async () => {
        const r = await form.saveSecrets();
        return r.ok ? createMcp(body) : { ok: false as const, error: r.error ?? "Could not save the keys" };
      }, done);
    return run(() => createMcp(body), done);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={cn("h-[min(720px,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[780px]", server && "sm:max-w-[520px]")}>
        <div className="flex h-full min-h-0">
          {!server && (
            <aside className="flex w-[300px] shrink-0 flex-col border-r bg-muted/60 p-4">
              <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5">
                <Search className="size-4 text-muted-foreground" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search MCP templates" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <button type="button" onClick={() => pick("custom")} className={cn("mt-3 flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-foreground/5", template === "custom" && "bg-foreground/10 font-medium")}>
                <Settings className="size-4" /> Custom MCP
              </button>
              <div className="my-3 border-t" />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="px-2.5 pb-1 text-xs text-muted-foreground">Templates</div>
                {shown.map((tp) => (
                  <button key={tp.id} type="button" onClick={() => pick(tp)} className={cn("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm hover:bg-foreground/5", t?.id === tp.id && "bg-foreground/10 font-medium")}>
                    <span className="flex size-5 items-center justify-center rounded border bg-background">
                      <McpIcon id={tp.id} className="size-3.5" />
                    </span>
                    {tp.name}
                  </button>
                ))}
                {shown.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No templates match.</div>}
              </div>
            </aside>
          )}
          <form
            className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void submit();
            }}
          >
            <div className="flex items-start gap-3">
              {t && (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border">
                  <McpIcon id={t.id} className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-semibold">{server ? `Edit ${server.name}` : t ? t.name : "Add custom MCP"}</DialogTitle>
                {t && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
                {t?.server.url && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{t.server.url}</p>}
              </div>
              <Button type="submit" variant={valid ? "default" : "secondary"} disabled={!valid || pending} className="h-9 px-4">
                {pending ? "Saving…" : server ? "Save" : "Add"}
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => onOpenChange(false)}>
                <X />
              </Button>
            </div>

            <label className="mt-5 grid gap-1.5">
              <span className="text-sm font-medium">Display name</span>
              <Input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="MCP server name" className="h-10" />
              {display && name !== display && <span className="text-xs text-muted-foreground">Agents refer to it as <code className="font-mono">{name || "…"}</code></span>}
            </label>

            {guided ? (
              <div className="mt-5">
                <McpFields fields={t!.fields!} values={form.values} onChange={form.setValues} docs={t!.docs} />
                <button
                  type="button"
                  className="mt-4 text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    if (parsed.ok) setConfig(toMcpJson(name || t!.id, parsed.server));
                    setShowJson(true);
                  }}
                >
                  Edit the JSON instead
                </button>
              </div>
            ) : (
              <>
                <p className="mt-4 text-sm text-muted-foreground">
                  Add a single MCP server as JSON. Use <code className="font-mono text-xs">url</code> and optional{" "}
                  <code className="font-mono text-xs">headers</code>, or <code className="font-mono text-xs">command</code> with optional{" "}
                  <code className="font-mono text-xs">args</code> and <code className="font-mono text-xs">env</code>. Use{" "}
                  <code className="font-mono text-xs">{"{{SECRET_NAME}}"}</code> anywhere in a header or environment value. Literal text is stored with this
                  config.
                </p>

                <div className="mt-4 grid gap-1.5">
                  <span className="text-sm font-medium">Configuration</span>
                  <JsonEditor value={config} onChange={setConfig} suggestion={CUSTOM_SUGGESTION} />
                  {config && !parsed.ok && <span className="text-xs text-destructive">{parsed.error}</span>}
                </div>
              </>
            )}

            {!guided && (
              <div className="mt-4 grid gap-1.5">
                <span className="text-sm font-medium">Connection mode</span>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {(
                    [
                      ["managed", "Kiln managed", "Kiln puts secret values into the harness's MCP config."],
                      ["direct", "Direct", "The config keeps ${NAME} references; values go into the run's environment."],
                    ] as const
                  ).map(([v, l, h]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={effectiveMode === v}
                      onClick={() => {
                        setMode(v);
                        setModeTouched(true);
                      }}
                      className={cn(
                        "flex flex-col justify-start rounded-lg border p-2.5 text-left hover:bg-muted",
                        effectiveMode === v && "border-foreground ring-1 ring-foreground",
                      )}
                    >
                      <div className="text-sm font-medium">{l}</div>
                      <div className="text-xs text-muted-foreground">{h}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="mt-4 grid gap-1.5">
              <span className="text-xs font-medium">Description (optional)</span>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What agents use it for" className="h-9" />
            </label>

            {!guided && refs.length > 0 && (
              <div className="mt-4 text-sm">
                <span className="text-muted-foreground">Secrets: </span>
                {refs.map((r) => (
                  <span key={r} className={cn("mr-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs", secrets.includes(r) ? "border-green-600/30 text-green-700 dark:text-green-400" : "border-amber-600/30 text-amber-700 dark:text-amber-400")}>
                    {r}
                    {!secrets.includes(r) && (
                      <a href={`/secrets/new?type=raw`} className="font-sans underline" target="_blank" rel="noreferrer">
                        add
                      </a>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 border-t pt-4 text-sm">
              <span className="text-muted-foreground">Available to factories:</span>
              <span>every factory in this team, for agents that list it in <code className="font-mono text-xs">mcpServers</code></span>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A plain code editor: line numbers, mono text, and a ghost suggestion inserted with Tab. */
function JsonEditor({ value, onChange, suggestion }: { value: string; onChange: (v: string) => void; suggestion: string }) {
  const lines = Math.max(1, (value || "").split("\n").length);
  return (
    <div className="relative flex min-h-64 overflow-hidden rounded-lg border bg-muted/50 font-mono text-xs leading-5">
      <div aria-hidden className="w-10 shrink-0 border-r bg-muted py-2 pr-2 text-right text-muted-foreground select-none">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        {!value && (
          <pre aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden px-3 py-2 whitespace-pre text-muted-foreground/60">
            {suggestion}
            <span className="ml-2 rounded border bg-background px-1 py-0.5 font-sans text-[10px] text-muted-foreground">Tab to insert</span>
          </pre>
        )}
        <textarea
          aria-label="MCP configuration"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !value) {
              e.preventDefault();
              onChange(suggestion);
            }
          }}
          rows={Math.max(12, lines)}
          className="relative h-full w-full resize-none bg-transparent px-3 py-2 whitespace-pre outline-none"
        />
      </div>
    </div>
  );
}
