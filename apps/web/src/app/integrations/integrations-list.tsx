"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { ConfirmAction, CopyButton } from "@/components/kiln/confirm-action";
import { PROVIDER_ICONS } from "@/components/kiln/provider-meta";
import { ConnectedBadge } from "@/components/kiln/settings-blocks";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { webhookUrl, type IntegrationSpec, type IntegrationState } from "@/lib/integration-catalog";
import { completeConnect, createGitHubApp, disconnectProvider, removeGitHubApp, startConnect, testConnect } from "./actions";

export type Row = {
  spec: IntegrationSpec;
  state: IntegrationState;
  error?: string;
  account?: { name: string; url?: string };
  connectedAt?: string;
  connectedBy?: string;
  lastTest?: { ok: boolean; message: string; at: string };
  available: boolean;
};

type Start = { state: string; url?: string; instructions?: string; steps?: string[]; fields?: { name: string; label: string; secret?: boolean; optional?: boolean }[] };

function Logo({ id, className = "size-6" }: { id: string; className?: string }) {
  const I = PROVIDER_ICONS[id];
  return I ? <I className={className} /> : <span className={className} />;
}

function StateBadge({ row }: { row: Row }) {
  if (row.state === "connected") return <ConnectedBadge />;
  if (row.state === "env") return <ConnectedBadge>Configured on server</ConnectedBadge>;
  if (row.state === "pending") return <ConnectedBadge tone="amber">Waiting for approval</ConnectedBadge>;
  if (row.state === "error") return <ConnectedBadge tone="amber">Needs attention</ConnectedBadge>;
  return null;
}

type GitHubApp = { slug: string; owner?: string; installationId?: string; installUrl: string };

export function IntegrationsList({ rows, publicUrl, canAdmin, connectionsApi, githubApps = [] }: { rows: Row[]; publicUrl: string; canAdmin: boolean; connectionsApi: boolean; githubApps?: GitHubApp[] }) {
  const sp = useSearchParams();
  // ?open=<id> opens that integration's panel (Studio's "Add repository" links to ?open=github).
  const [open, setOpen] = useState<string | undefined>(() => {
    const id = sp.get("open");
    return id && rows.some((r) => r.spec.id === id) ? id : undefined;
  });
  const [removing, setRemoving] = useState<Row>();
  const [pending, run] = useAction();
  const router = useRouter();
  const path = usePathname();

  // OAuth providers send people back here with ?provider=…&connected=1 or &error=…
  useEffect(() => {
    const provider = sp.get("provider");
    if (!provider) return;
    const name = rows.find((r) => r.spec.connection === provider)?.spec.name ?? provider;
    if (sp.get("connected")) toast.success(`${name} connected`);
    else if (sp.get("error")) toast.error(`${name}: ${sp.get("error")}`);
    router.replace(path);
  }, [sp, rows, router, path]);

  const connect = (row: Row) => {
    if (!row.spec.connection || !connectionsApi) {
      setOpen(row.spec.id);
      return;
    }
    void run(() => startConnect(row.spec.connection!), {
      onSuccess: (s) => {
        if (s?.url) window.location.assign(s.url);
        else setOpen(row.spec.id);
      },
    });
  };

  const current = rows.find((r) => r.spec.id === open);
  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-muted/60 dark:bg-muted/30">
        {rows.map((row) => {
          const on = row.state !== "off";
          return (
            <div key={row.spec.id} className="flex min-h-16 items-center gap-4 border-b px-5 py-3 last:border-b-0">
              <Logo id={row.spec.id} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{row.spec.name}</div>
                <div className="text-sm text-muted-foreground">{row.spec.description}</div>
                {row.state === "error" && row.error && <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{row.error}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StateBadge row={row} />
                {canAdmin && (on ? (
                  <Button variant="outline" onClick={() => setOpen(row.spec.id)}>
                    Configure
                  </Button>
                ) : (
                  <Button variant="outline" disabled={pending} onClick={() => connect(row)}>
                    {row.spec.connection ? "Connect" : "Set up"}
                  </Button>
                ))}
                {!canAdmin && !on && (
                  <Button variant="ghost" onClick={() => setOpen(row.spec.id)}>
                    How to connect
                  </Button>
                )}
                {canAdmin && (row.state === "connected" || row.state === "pending" || row.state === "error") && row.spec.connection && connectionsApi && (
                  <Button variant="ghost" size="icon" aria-label={`Remove ${row.spec.name}`} onClick={() => setRemoving(row)} className="text-red-600 hover:bg-red-500/10 hover:text-red-600">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmAction
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(undefined)}
        title={`Disconnect ${removing?.spec.name}?`}
        description="Kiln deletes the stored credentials. Factories that use it stop getting its events and can't post back until you connect again."
        confirmLabel="Disconnect"
        action={() => disconnectProvider(removing!.spec.connection!, removing!.spec.name)}
      />

      <Sheet open={Boolean(current)} onOpenChange={(o) => !o && setOpen(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">{current && <ConfigureSheet row={current} publicUrl={publicUrl} canAdmin={canAdmin} connectionsApi={connectionsApi} githubApps={githubApps} onDone={() => setOpen(undefined)} />}</SheetContent>
      </Sheet>
    </>
  );
}

function ConfigureSheet({ row, publicUrl, canAdmin, connectionsApi, githubApps, onDone }: { row: Row; publicUrl: string; canAdmin: boolean; connectionsApi: boolean; githubApps: GitHubApp[]; onDone: () => void }) {
  const { spec } = row;
  const [start, setStart] = useState<Start>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, run] = useAction();
  const connected = row.state === "connected" || row.state === "error" || row.state === "pending";

  const begin = () =>
    void run(() => startConnect(spec.connection!), {
      onSuccess: (s) => {
        if (s?.url) window.location.assign(s.url);
        else if (s) setStart(s);
      },
    });

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border">
            <Logo id={spec.id} className="size-5" />
          </span>
          <div>
            <SheetTitle>{spec.name}</SheetTitle>
            <SheetDescription>{spec.description}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="space-y-6 px-4 pb-8 text-sm">
        <section className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Status</span>
            {row.state === "off" ? <ConnectedBadge tone="grey">Not connected</ConnectedBadge> : <StateBadge row={row} />}
          </div>
          {row.account && (
            <div className="mt-2 text-muted-foreground">
              Account:{" "}
              {row.account.url ? (
                <a href={row.account.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline">
                  {row.account.name}
                </a>
              ) : (
                <span className="font-medium text-foreground">{row.account.name}</span>
              )}
            </div>
          )}
          {row.connectedAt && (
            <div className="mt-1 text-xs text-muted-foreground">
              Connected {new Date(row.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              {row.connectedBy ? ` by ${row.connectedBy}` : ""}
            </div>
          )}
          {row.lastTest && (
            <div className={`mt-1 text-xs ${row.lastTest.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}>
              Last test: {row.lastTest.message}
            </div>
          )}
          {row.state === "error" && row.error && <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">{row.error}</div>}
          {row.state === "env" && <p className="mt-2 text-muted-foreground">Configured with environment variables on the Kiln server. Change them there and restart the API.</p>}
          {canAdmin && spec.connection && connectionsApi && (
            <div className="mt-3 flex gap-2">
              {connected ? (
                <Button variant="outline" disabled={pending} onClick={() => void run(() => testConnect(spec.connection!))}>
                  Test connection
                </Button>
              ) : (
                !start && (
                  <Button disabled={pending} onClick={begin}>
                    Connect {spec.name}
                  </Button>
                )
              )}
              {connected && (
                <Button variant="ghost" disabled={pending} onClick={begin}>
                  Reconnect
                </Button>
              )}
            </div>
          )}
        </section>

        {spec.connection === "github" && githubApps.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-semibold">GitHub Apps</h3>
            <ul className="divide-y rounded-lg border">
              {githubApps.map((a) => (
                <li key={a.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <a href={`https://github.com/apps/${a.slug}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {a.slug}
                    </a>
                    <span className="block text-xs text-muted-foreground">{a.owner ? `Owned by ${a.owner}` : ""}{a.installationId ? " · installed" : " · not installed yet"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <a href={a.installUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-muted-foreground hover:text-foreground">
                      {a.installationId ? "Repositories" : "Install"}
                    </a>
                    {canAdmin && (
                      <ConfirmAction
                        trigger={(open) => (
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${a.slug}`} onClick={open}>
                            <Trash2 />
                          </Button>
                        )}
                        title={`Remove ${a.slug}?`}
                        description="Kiln forgets the app's key and stops using it for repositories and webhooks. The app stays on GitHub: delete it there in the app's settings, under Advanced."
                        confirmLabel="Remove"
                        action={() => removeGitHubApp(a.slug)}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {canAdmin && spec.connection === "github" && connectionsApi && <CreateGitHubApp another={githubApps.length > 0 || connected} />}

        {start && (
          <section className="space-y-3">
            <h3 className="font-semibold">Connect {spec.name}</h3>
            {start.instructions && <p className="text-muted-foreground">{start.instructions}</p>}
            {start.steps && start.steps.length > 0 && (
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {start.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            {start.fields && start.fields.length > 0 && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => completeConnect(spec.connection!, start.state, values), { onSuccess: onDone });
                }}
              >
                {start.fields.map((f) => (
                  <label key={f.name} className="grid gap-1.5">
                    <span className="font-medium">
                      {f.label}
                      {f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
                    </span>
                    <Input type={f.secret ? "password" : "text"} autoComplete="off" required={!f.optional} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className="h-9 font-mono" />
                  </label>
                ))}
                <Button type="submit" disabled={pending}>
                  {pending ? "Connecting…" : "Save and connect"}
                </Button>
              </form>
            )}
          </section>
        )}

        <section className="space-y-3">
          <h3 className="font-semibold">Self-hosting</h3>
          <p className="text-muted-foreground">Set these on the API server instead of connecting here. Environment variables take precedence over a connection.</p>
          <ul className="divide-y rounded-lg border">
            {spec.env.map((e) => (
              <li key={e.name} className="flex items-center gap-2 px-3 py-2">
                <code className="font-mono text-xs">{e.name}</code>
                {e.note && <span className="text-xs text-muted-foreground">{e.note}</span>}
              </li>
            ))}
          </ul>
          {spec.webhook && (
            <div className="space-y-1.5">
              <div className="font-medium">Webhook URL</div>
              <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
                <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{webhookUrl(publicUrl, spec.webhook)}</code>
                <CopyButton value={webhookUrl(publicUrl, spec.webhook)} size="icon-sm" variant="ghost" />
              </div>
              {spec.events && <div className="text-xs text-muted-foreground">Events: {spec.events}</div>}
            </div>
          )}
          {spec.oauthCallback && spec.connection && (
            <div className="space-y-1.5">
              <div className="font-medium">OAuth redirect URL</div>
              <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
                <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{webhookUrl(publicUrl, `/oauth/${spec.connection}/callback`)}</code>
                <CopyButton value={webhookUrl(publicUrl, `/oauth/${spec.connection}/callback`)} size="icon-sm" variant="ghost" />
              </div>
            </div>
          )}
          {spec.docs && (
            <Link href={`/docs/${spec.docs}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
              <BookOpen className="size-4" /> {spec.name} setup guide <ExternalLink className="size-3 text-muted-foreground" />
            </Link>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * One click to Kiln's own GitHub App: GitHub creates it from Kiln's manifest (permissions, events,
 * webhook), hands its key to the Kiln server, then asks where to install it.
 */
function CreateGitHubApp({ another }: { another: boolean }) {
  const [org, setOrg] = useState("");
  const [pending, run] = useAction();
  const create = () =>
    void run(() => createGitHubApp(org), {
      onSuccess: (r) => {
        if (!r) return;
        const form = document.createElement("form");
        form.method = "post";
        form.action = r.action;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "manifest";
        input.value = JSON.stringify(r.manifest);
        form.append(input);
        document.body.append(form);
        form.submit();
      },
    });
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{another ? "Add a GitHub account or organization" : "Create a GitHub App for Kiln"}</h3>
      <p className="text-muted-foreground">
        {another ? "Each account or organization gets its own private app. " : ""}GitHub creates the app with the permissions, events and webhook Kiln needs and gives its key to this server. You then pick the repositories to install it on. Nothing to copy.
      </p>
      <label className="grid gap-1.5">
        <span className="font-medium">
          Organization <span className="font-normal text-muted-foreground">(optional; empty creates it on your account)</span>
        </span>
        <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="acme" autoComplete="off" className="h-9 font-mono" />
      </label>
      <Button disabled={pending} onClick={create}>
        {pending ? "Opening GitHub…" : "Create GitHub App"}
      </Button>
    </section>
  );
}
