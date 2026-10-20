"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelKeyProvider, PoolEntry, TeamSettings } from "@kiln/sdk-ts";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { ConnectedBadge, Field, SettingsRow } from "@/components/kiln/settings-blocks";
import { SimpleSelect } from "@/components/kiln/simple-select";
import { TagListInput } from "@/components/kiln/tag-list-input";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { byHeadroom, resetsIn, tokenStatus, usageLine } from "@/lib/claude-tokens";
import { cn } from "@/lib/utils";
import * as A from "./actions";

type StorageTarget = TeamSettings["storage"]["artifacts"];
type KeyState = { set: boolean; updatedAt?: string; updatedBy?: string };

const MODEL_KEYS: { id: ModelKeyProvider; title: string; description: React.ReactNode; placeholder: string }[] = [
  { id: "anthropic", title: "Anthropic API key", description: "Claude Code and OpenCode runs bill this key.", placeholder: "sk-ant-api03-…" },
  { id: "openai", title: "OpenAI API key", description: "Codex and OpenCode runs, or any OpenAI-compatible gateway key.", placeholder: "sk-proj-…" },
  { id: "openrouter", title: "OpenRouter API key", description: "OpenCode through OpenRouter, including open-weight models.", placeholder: "sk-or-v1-…" },
  { id: "bedrock", title: "Amazon Bedrock", description: "Claude Code on Bedrock, with an access key or a Bedrock API key.", placeholder: "" },
];

function since(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

export function ModelKeys({ team, keys, pool, canEdit }: { team: string; keys: Partial<Record<ModelKeyProvider, KeyState>>; pool: PoolEntry[]; canEdit: boolean }) {
  return (
    <div>
      <p className="mb-5 text-sm text-muted-foreground">Runs without their own harness credential use these. Values are write-only: Kiln never shows them again and redacts them from run output.</p>
      <ClaudeTokenPool team={team} pool={pool} canEdit={canEdit} />
      {MODEL_KEYS.map((k) => (
        <ModelKeyRow key={k.id} team={team} spec={k} state={keys[k.id] ?? { set: false }} canEdit={canEdit} />
      ))}
    </div>
  );
}

/** Claude subscription tokens: each one's status and 5-hour and 7-day usage; runs use the one with the most left. */
function ClaudeTokenPool({ team, pool, canEdit }: { team: string; pool: PoolEntry[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [pending, run] = useAction();
  const router = useRouter();
  const validName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name.trim());
  return (
    <div className="border-b pb-4 mb-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Claude subscription tokens</div>
          <div className="text-sm text-muted-foreground">
            Run <code className="font-mono text-xs">claude setup-token</code> and add the token. With several, each run uses the working one with the most of its 5-hour and 7-day limits left, and skips rejected or limited ones until they reset.
          </div>
        </div>
        {canEdit && !adding && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            Add token
          </Button>
        )}
      </div>
      {pool.length === 0 && !adding && <p className="mt-3 text-sm text-muted-foreground">No tokens yet. Runs fall back to the API keys below or to the server&apos;s environment.</p>}
      {pool.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border bg-background">
          {byHeadroom(pool).map((t) => {
            const s = tokenStatus(t);
            return (
              <li key={`${t.scope}:${t.name}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{t.name}</code>
                <ConnectedBadge tone={s.tone}>{s.label}</ConnectedBadge>
                <UsageBar label="5h" window={t.fiveHour} />
                <UsageBar label="7d" window={t.sevenDay} />
                {t.status === "limited" && t.resetsAt && <span className="text-xs text-muted-foreground">usable {resetsIn(t.resetsAt)}</span>}
                {t.status === "invalid" && t.error && <span className="w-full truncate text-xs text-destructive" title={t.error}>{t.error}</span>}
                {canEdit && (
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => A.checkClaudeToken(team, t.name), { onSuccess: () => router.refresh() })}>
                      Check now
                    </Button>
                    <ConfirmAction
                      title={`Remove ${t.name}?`}
                      description="Runs stop using this token. The other tokens keep working."
                      confirmLabel="Remove"
                      action={() => A.deleteClaudeToken(t.name)}
                      onDone={() => router.refresh()}
                      trigger={(open) => (
                        <Button variant="ghost" size="sm" onClick={open} className="text-destructive hover:text-destructive">
                          Remove
                        </Button>
                      )}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => A.addClaudeToken(name, value), { onSuccess: () => (setAdding(false), setName(""), setValue(""), router.refresh()) });
          }}
        >
          <Input autoFocus placeholder="CLAUDE_ALICE" value={name} onChange={(e) => setName(e.target.value)} className="h-9 bg-background font-mono" aria-label="Token name" />
          <Input type="password" autoComplete="off" placeholder="sk-ant-oat01-…" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 bg-background font-mono" aria-label="Token" />
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !validName || !value.trim()}>
            {pending ? "Saving…" : "Add"}
          </Button>
        </form>
      )}
    </div>
  );
}

function UsageBar({ label, window }: { label: string; window: PoolEntry["fiveHour"] }) {
  const pct = Math.min(100, Math.round((window?.utilization ?? 0) * 100));
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={usageLine(window) ?? "No usage reported yet"}>
      {label}
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-amber-500" : "bg-foreground/60")} style={{ width: `${window ? pct : 0}%` }} />
      </span>
      <span className="w-8 tabular-nums">{window ? `${pct}%` : "–"}</span>
    </span>
  );
}

function ModelKeyRow({ team, spec, state, canEdit }: { team: string; spec: (typeof MODEL_KEYS)[number]; state: KeyState; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [bedrock, setBedrock] = useState({ mode: "access", accessKeyId: "", secretAccessKey: "", apiKey: "", region: "us-east-1" });
  const [pending, run] = useAction();
  const router = useRouter();
  const save = () => {
    const done = { onSuccess: () => (setEditing(false), setValue(""), router.refresh()) };
    if (spec.id === "bedrock") {
      const v: Record<string, string> = bedrock.mode === "access" ? { accessKeyId: bedrock.accessKeyId, secretAccessKey: bedrock.secretAccessKey, region: bedrock.region } : { apiKey: bedrock.apiKey, region: bedrock.region };
      return run(() => A.setModelKey(team, "bedrock", v), done);
    }
    return run(() => A.setModelKey(team, spec.id, value.trim()), done);
  };
  const remove = () => A.deleteModelKey(team, spec.id);
  const valid = spec.id === "bedrock" ? (bedrock.mode === "access" ? bedrock.accessKeyId && bedrock.secretAccessKey && bedrock.region : bedrock.apiKey && bedrock.region) : value.trim();
  return (
    <div className="py-4 first:pt-0 last:pb-0 [&+&]:border-t">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {spec.title}
            {state.set ? <ConnectedBadge>Set</ConnectedBadge> : <ConnectedBadge tone="grey">Not set</ConnectedBadge>}
          </div>
          <div className="text-sm text-muted-foreground">{spec.description}</div>
          {state.set && state.updatedAt && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Updated {since(state.updatedAt)}
              {state.updatedBy ? ` by ${state.updatedBy}` : ""}
            </div>
          )}
        </div>
        {canEdit && !editing && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {state.set ? "Replace" : "Set key"}
            </Button>
            {state.set && (
              <ConfirmAction
                title={`Remove the ${spec.title}?`}
                description="Runs that relied on it fail until another credential is available."
                confirmLabel="Remove"
                action={remove}
                onDone={() => router.refresh()}
                trigger={(open) => (
                  <Button variant="ghost" onClick={open} className="text-destructive hover:text-destructive">
                    Remove
                  </Button>
                )}
              />
            )}
          </div>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {spec.id === "bedrock" ? (
            <>
              <div className="flex gap-1 rounded-lg border bg-background p-0.5 text-sm" role="radiogroup">
                {[
                  ["access", "Access key"],
                  ["api", "Bedrock API key"],
                ].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={bedrock.mode === v} onClick={() => setBedrock({ ...bedrock, mode: v! })} className={cn("flex-1 rounded-md px-2 py-1 text-muted-foreground", bedrock.mode === v && "bg-muted font-medium text-foreground")}>
                    {l}
                  </button>
                ))}
              </div>
              {bedrock.mode === "access" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input autoComplete="off" placeholder="Access key ID" value={bedrock.accessKeyId} onChange={(e) => setBedrock({ ...bedrock, accessKeyId: e.target.value })} className="h-9 bg-background font-mono" />
                  <Input type="password" autoComplete="off" placeholder="Secret access key" value={bedrock.secretAccessKey} onChange={(e) => setBedrock({ ...bedrock, secretAccessKey: e.target.value })} className="h-9 bg-background font-mono" />
                </div>
              ) : (
                <Input type="password" autoComplete="off" placeholder="Bedrock API key" value={bedrock.apiKey} onChange={(e) => setBedrock({ ...bedrock, apiKey: e.target.value })} className="h-9 bg-background font-mono" />
              )}
              <Input placeholder="Region, e.g. us-east-1" value={bedrock.region} onChange={(e) => setBedrock({ ...bedrock, region: e.target.value })} className="h-9 bg-background font-mono" />
            </>
          ) : (
            <Input type="password" autoComplete="off" autoFocus placeholder={spec.placeholder} value={value} onChange={(e) => setValue(e.target.value)} className="h-9 bg-background font-mono" />
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SpendLimit({ team, limit, canEdit }: { team: string; limit: TeamSettings["spendLimit"]; canEdit: boolean }) {
  const [amount, setAmount] = useState(String(limit.monthlyUsd));
  const [autoStop, setAutoStop] = useState(limit.autoStop);
  const [pending, run] = useAction();
  const n = Number(amount);
  const dirty = n !== limit.monthlyUsd || autoStop !== limit.autoStop;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => A.updateSettings(team, { spendLimit: { monthlyUsd: n, autoStop } }, "Spend limit saved"));
      }}
    >
      <Field label="Monthly limit" description="What the team's runs may cost per calendar month (UTC), as the harnesses report it." htmlFor="spend-amount">
        <div className="relative w-48">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <Input id="spend-amount" type="number" min={0} step={1} value={amount} disabled={!canEdit} onChange={(e) => setAmount(e.target.value)} className="h-10 bg-background pl-6 tabular-nums" />
        </div>
      </Field>
      <Field label="Stop at the limit" description="When on, Kiln refuses new runs once the month's spend reaches the limit. When off, the limit is a warning.">
        <div className="flex items-center gap-2">
          <Switch checked={autoStop} onCheckedChange={setAutoStop} disabled={!canEdit} aria-label="Stop at the limit" />
          <span className="text-sm">{autoStop ? "Auto-stop on" : "Soft limit"}</span>
        </div>
      </Field>
      {canEdit && (
        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={pending || !dirty || !(n >= 0)} variant={dirty ? "default" : "secondary"}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}

const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const HOST = /^(\*\.)?[A-Za-z0-9.-]+(:\d+)?$/;

/** A list setting (GitHub orgs, egress hosts) with its own Save. */
export function ListSetting({
  team,
  field,
  initial,
  canEdit,
  placeholder,
  label,
  description,
}: {
  team: string;
  field: "githubOrgs" | "egressAllowlist";
  initial: string[];
  canEdit: boolean;
  placeholder: string;
  label: string;
  description: React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [pending, run] = useAction();
  const validate = (v: string) => (field === "githubOrgs" ? (ORG.test(v) ? undefined : `${v} is not a GitHub org name`) : HOST.test(v) ? undefined : `${v} is not a host name`);
  const dirty = value.join("\n") !== initial.join("\n");
  return (
    <Field label={label} description={description}>
      <TagListInput value={value} onChange={setValue} placeholder={placeholder} disabled={!canEdit} validate={validate} mono />
      {canEdit && (
        <div className="flex justify-end pt-2">
          <Button disabled={pending || !dirty} onClick={() => void run(() => A.updateSettings(team, { [field]: value }))} variant={dirty ? "default" : "secondary"}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </Field>
  );
}

const HOSTS = [
  { value: "none", label: "Server default", hint: "Use the server's KILN_SANDBOX backend" },
  { value: "local", label: "Local", hint: "Processes on the Kiln server (development only)" },
  { value: "docker", label: "Docker", hint: "One container per run" },
  { value: "kubernetes", label: "Kubernetes", hint: "One pod per run, gVisor where available" },
];

const FACTORY_DEFAULTS = [
  { value: "none", label: "No access", hint: "Members see only factories they are granted" },
  { value: "user", label: "User", hint: "See factories, send work, decide gates" },
  { value: "editor", label: "Editor", hint: "Also edit definitions and confirm merges" },
];

export function HostAndRoles({ team, settings, canEdit }: { team: string; settings: TeamSettings; canEdit: boolean }) {
  const [, run] = useAction();
  const router = useRouter();
  return (
    <div>
      <SettingsRow label="Default sandbox host" hint="For agents that name no runner">
        <SimpleSelect
          value={settings.defaultSandboxHost ?? "none"}
          options={HOSTS}
          disabled={!canEdit}
          ariaLabel="Default sandbox host"
          onChange={(v) => void run(() => A.updateSettings(team, { defaultSandboxHost: v === "none" ? undefined : v }, "Sandbox host saved"), { onSuccess: () => router.refresh() })}
        />
      </SettingsRow>
      <SettingsRow label="Default factory role" hint="What every member can do in the team's factories">
        <SimpleSelect
          value={settings.defaultFactoryRole}
          options={FACTORY_DEFAULTS}
          disabled={!canEdit}
          ariaLabel="Default factory role"
          onChange={(v) => void run(() => A.updateSettings(team, { defaultFactoryRole: v as TeamSettings["defaultFactoryRole"] }, "Default role saved"), { onSuccess: () => router.refresh() })}
        />
      </SettingsRow>
    </div>
  );
}

const CATEGORIES = [
  ["artifacts", "Artifacts", "Screenshots, videos and files that runs produce"],
  ["transcripts", "Transcripts", "Agent conversations and tool calls"],
  ["attachments", "Attachments", "Files people attach to tasks and follow-ups"],
] as const;

export function DataStorage({ team, storage, canEdit }: { team: string; storage: TeamSettings["storage"]; canEdit: boolean }) {
  const [state, setState] = useState(storage);
  const [pending, run] = useAction();
  const dirty = JSON.stringify(state) !== JSON.stringify(storage);
  const set = (k: keyof TeamSettings["storage"], v: StorageTarget) => setState({ ...state, [k]: v });
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Where each kind of run data should live: a folder on the Kiln server, or an S3-compatible bucket you own. Kiln validates and stores these; writing to a team bucket is not built yet, so files still go to the server&apos;s object store.</p>
      {CATEGORIES.map(([key, title, hint]) => {
        const t = state[key];
        return (
          <div key={key} className="py-4 first:pt-0 [&+&]:border-t">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-sm text-muted-foreground">{hint}</div>
              </div>
              <SimpleSelect
                className="w-44"
                value={t.kind}
                disabled={!canEdit}
                ariaLabel={`${title} storage`}
                options={[
                  { value: "local", label: "Kiln server" },
                  { value: "s3", label: "S3-compatible bucket" },
                ]}
                onChange={(v) => set(key, v === "local" ? { kind: "local" } : { kind: "s3", bucket: "", region: "us-east-1" })}
              />
            </div>
            {t.kind === "local" ? (
              <Input disabled={!canEdit} placeholder="Path (optional, defaults to KILN_DATA_DIR/objects)" value={t.path ?? ""} onChange={(e) => set(key, { kind: "local", ...(e.target.value ? { path: e.target.value } : {}) })} className="mt-3 h-9 bg-background font-mono" />
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["bucket", "Bucket"],
                    ["region", "Region"],
                    ["endpoint", "Endpoint URL (optional, for R2 or MinIO)"],
                    ["prefix", "Key prefix (optional)"],
                    ["accessKeyIdSecret", "Team secret with the access key ID"],
                    ["secretAccessKeySecret", "Team secret with the secret key"],
                  ] as const
                ).map(([f, ph]) => (
                  <Input
                    key={f}
                    disabled={!canEdit}
                    placeholder={ph}
                    aria-label={ph}
                    value={(t[f] as string | undefined) ?? ""}
                    onChange={(e) => {
                      const next = { ...t } as Record<string, unknown>;
                      if (e.target.value) next[f] = e.target.value;
                      else if (f === "bucket" || f === "region") next[f] = "";
                      else delete next[f];
                      set(key, next as StorageTarget);
                    }}
                    className="h-9 bg-background font-mono"
                  />
                ))}
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Switch size="sm" disabled={!canEdit} checked={Boolean(t.forcePathStyle)} onCheckedChange={(v) => set(key, { ...t, forcePathStyle: v || undefined })} />
                  Path-style URLs (MinIO and some S3-compatible stores)
                </label>
              </div>
            )}
          </div>
        );
      })}
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button disabled={pending || !dirty} onClick={() => void run(() => A.updateSettings(team, { storage: state }, "Storage saved"))} variant={dirty ? "default" : "secondary"}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function LeaveTeam({ team, me, lastOwner }: { team: string; me: string; lastOwner: boolean }) {
  const router = useRouter();
  return (
    <ConfirmAction
      title="Leave this team?"
      description="You lose access to its factories, secrets and keys. Someone has to invite you again to come back."
      confirmLabel="Leave team"
      action={() => A.removeMember(team, me, true)}
      onDone={() => router.push("/teams/switch?next=/")}
      trigger={(open) => (
        <Button variant="outline" disabled={lastOwner} onClick={open} className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive">
          Leave team
        </Button>
      )}
    />
  );
}
