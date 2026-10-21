"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ellipsis, Pencil, Plug, Server, Trash2, X } from "lucide-react";
import type { McpServer } from "@kiln/sdk-ts";
import { ConfirmAction, CopyButton } from "@/components/kiln/confirm-action";
import { ConnectedBadge, EmptyIcon } from "@/components/kiln/settings-blocks";
import { PageHeader, Pre } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { McpFields, useMcpFields } from "@/components/kiln/mcp-fields";
import { McpTestButton } from "@/components/kiln/mcp-test";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BUILTIN_SETUP, MCP_TEMPLATES, secretRefs } from "@/lib/mcp-config";
import { deleteMcp } from "./actions";
import { McpDialog, McpIcon } from "./mcp-dialog";

type Builtin = { kiln_id: string; name: string; description: string; connected: boolean; missing: string[] };

const TOOLS: [string, string][] = [
  ["list_factories", "List the factories the token can see"],
  ["send_task", "Send work to a factory's foreman"],
  ["get_task", "Get a task; start_working=true returns branch and clone URL"],
  ["message_foreman", "Message the foreman; answers its open question"],
  ["complete_task", "Hand a local task back, or confirm it landed"],
  ["validate_factory_files", "Validate a definition tree; apply=true writes it"],
  ["list_inbox", "Open decisions waiting on people"],
  ["decide_gate", "Approve, reject or answer a gate"],
  ["get_metrics", "PRs, autonomy, cycle time, cost per merged PR"],
  ["steer_run", "Steer a running agent"],
];

/** Which template a saved server most likely came from, for its icon. */
function iconFor(s: McpServer): string | undefined {
  const t = MCP_TEMPLATES.find((t) => (t.server.url && t.server.url === s.url) || (t.server.command && t.server.args?.[1] && s.args?.includes(t.server.args[1])));
  return t?.id ?? (s.url ? "custom-url" : "custom-stdio");
}

export function McpPage({ servers, builtins, secrets, mcpUrl, canEdit }: { servers: McpServer[]; builtins: Builtin[]; secrets: string[]; mcpUrl: string; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpServer>();
  const [deleting, setDeleting] = useState<McpServer>();
  const [kilnMcp, setKilnMcp] = useState(false);
  const [connecting, setConnecting] = useState<Builtin>();
  const empty = servers.length === 0 && builtins.length === 0;

  const actions = (
    <>
      <Button variant="outline" onClick={() => setKilnMcp(true)}>
        <Plug /> Connect to Kiln MCP
      </Button>
      {canEdit && !empty && <McpTestButton scope={{}} label="Test all" title="MCP servers" variant="outline" />}
      {canEdit && (
        <Button className="h-8 px-3" onClick={() => setAdding(true)}>
          New
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader crumbs={[{ label: "MCPs and apps" }]} actions={actions} />
      {empty ? (
        <EmptyIcon className="min-h-[calc(100vh-7rem)]" icon={<Server className="size-5" />} title="No MCPs or apps yet" action={canEdit ? <Button className="h-8 px-4" onClick={() => setAdding(true)}>New</Button> : undefined}>
          Team-managed MCP servers available to your factories will appear here.
        </EmptyIcon>
      ) : (
        <div className="mx-auto w-full max-w-[820px] px-6 py-8">
          <p className="mb-4 text-sm text-muted-foreground">MCP servers this team&apos;s agents can use. An agent gets a server when its definition lists it under <code className="font-mono text-xs">mcpServers</code>, by name.</p>
          <ul className="divide-y overflow-hidden rounded-xl border bg-muted/60 dark:bg-muted/30">
            {servers.map((s) => {
              const refs = secretRefs(s);
              const missing = refs.filter((r) => !secrets.includes(r));
              return (
                <li key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                    <McpIcon id={iconFor(s)} className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{s.name}</span>
                      <Badge variant="outline">{s.mode === "managed" ? "Kiln managed" : "Direct"}</Badge>
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{s.description || (s.url ?? [s.command, ...(s.args ?? [])].join(" "))}</div>
                    {s.description && <div className="truncate font-mono text-xs text-muted-foreground">{s.url ?? [s.command, ...(s.args ?? [])].join(" ")}</div>}
                  </div>
                  {missing.length > 0 ? <ConnectedBadge tone="amber">Needs {missing.join(", ")}</ConnectedBadge> : <ConnectedBadge>Ready</ConnectedBadge>}
                  {canEdit && missing.length === 0 && <McpTestButton scope={{ servers: [s.name] }} title={s.name} />}
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`} />}>
                        <Ellipsis />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => setEditing(s)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(s)}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
            {builtins.map((b) => (
              <li key={b.kiln_id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <McpIcon id={b.kiln_id} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{b.kiln_id}</span>
                    <Badge variant="secondary">Built in</Badge>
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{b.description}</div>
                </div>
                {b.connected ? (
                  <>
                    <ConnectedBadge />
                    {canEdit && <McpTestButton scope={{ servers: [b.kiln_id] }} title={b.kiln_id} />}
                  </>
                ) : canEdit && BUILTIN_SETUP[b.kiln_id] ? (
                  <Button variant="outline" size="sm" onClick={() => setConnecting(b)}>
                    Connect
                  </Button>
                ) : (
                  <ConnectedBadge tone="grey">Needs {b.missing.join(", ")}</ConnectedBadge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {connecting && <ConnectBuiltinDialog key={connecting.kiln_id} builtin={connecting} onClose={() => setConnecting(undefined)} />}
      <McpDialog open={adding} onOpenChange={setAdding} secrets={secrets} builtins={builtins} />
      {editing && <McpDialog key={editing.id} open onOpenChange={(o) => !o && setEditing(undefined)} secrets={secrets} builtins={builtins} server={editing} />}
      <ConfirmAction
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={`Delete ${deleting?.name}?`}
        description="Agents that list this server will skip it on their next run."
        action={() => deleteMcp(deleting!.id, deleting!.name)}
      />

      <Sheet open={kilnMcp} onOpenChange={setKilnMcp}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Connect to Kiln MCP</SheetTitle>
            <SheetDescription>Let Claude Code, Codex or any MCP client send work to factories, pull tasks to a local worktree, hand them back and decide gates. Calls use the caller&apos;s key, so factory roles apply.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6 text-sm">
            <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
              <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{mcpUrl}</code>
              <CopyButton value={mcpUrl} />
            </div>
            <div>
              <div className="mb-1 font-medium">Claude Code</div>
              <Pre>{`claude mcp add --transport http kiln ${mcpUrl} --header "Authorization: Bearer $KILN_TOKEN"`}</Pre>
            </div>
            <div>
              <div className="mb-1 font-medium">Codex</div>
              <Pre>{`[mcp_servers.kiln]\nurl = "${mcpUrl}"\nbearer_token_env_var = "KILN_TOKEN"`}</Pre>
            </div>
            <p className="text-muted-foreground">
              Create a key under <a href="/settings#api-keys" className="font-medium text-foreground underline-offset-4 hover:underline">Settings › API keys</a> and export it as <code className="font-mono text-xs">KILN_TOKEN</code>.
            </p>
            <div>
              <div className="mb-1 font-medium">Tools</div>
              <ul className="divide-y rounded-lg border">
                {TOOLS.map(([n, d]) => (
                  <li key={n} className="px-3 py-2">
                    <div className="font-mono text-xs">{n}</div>
                    <div className="text-xs text-muted-foreground">{d}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Connect a built-in server: one labeled field per secret it needs. */
function ConnectBuiltinDialog({ builtin, onClose }: { builtin: Builtin; onClose: () => void }) {
  const setup = BUILTIN_SETUP[builtin.kiln_id]!;
  const form = useMcpFields(setup.fields, builtin.missing, setup.name);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () =>
    start(async () => {
      const r = await form.saveSecrets();
      if (!r.ok) return void toast.error(r.error ?? `Could not connect ${setup.name}`);
      toast.success(`Connected ${setup.name}`);
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 p-6 sm:max-w-[520px]">
        <div className="mb-1 flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border">
            <McpIcon id={builtin.kiln_id} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold">Connect {setup.name}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">{builtin.description}</p>
          </div>
          <Button onClick={save} disabled={pending || !form.ready} className="h-9 px-4">
            {pending ? "Saving…" : "Connect"}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="mt-4">
          <McpFields fields={setup.fields} values={form.values} onChange={form.setValues} missing={builtin.missing} docs={setup.docs} />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Agents use it by listing <code className="font-mono">{builtin.kiln_id}</code> under <code className="font-mono">mcpServers</code>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
