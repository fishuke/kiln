"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Laptop, Moon, Plus, Sun, Trash2, Upload, X } from "lucide-react";
import type { ApiKeyRow, DigestPrefs, LinkedAccount, LinkProvider, NotificationPrefs, NotificationRecord } from "@kiln/sdk-ts";
import { ConfirmAction, CopyButton } from "@/components/kiln/confirm-action";
import { LINK_META } from "@/components/kiln/provider-meta";
import { AvatarBox, ConnectedBadge, Field } from "@/components/kiln/settings-blocks";
import { useTheme, type ThemePreference } from "@/components/kiln/theme";
import { useAction } from "@/components/kiln/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS, notificationLabel, withDefaults } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import * as A from "./actions";

export function ProfileForm({ name, email, avatar }: { name: string; email: string; avatar?: string }) {
  const [pending, run] = useAction();
  const [n, setN] = useState(name);
  const [e, setE] = useState(email);
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const dirty = n.trim() !== name || e.trim() !== email;
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(() => A.updateProfile({ name: n, email: e }), { onSuccess: () => router.refresh() });
      }}
    >
      <Field label="Name" description="How teammates see you in runs, reviews and the inbox." htmlFor="profile-name">
        <Input id="profile-name" value={n} onChange={(ev) => setN(ev.target.value)} className="h-10 bg-background" required />
      </Field>
      <Field label="Email" description="Used to log in and to match you in Linear, Jira and Slack." htmlFor="profile-email">
        <Input id="profile-email" type="email" value={e} onChange={(ev) => setE(ev.target.value)} className="h-10 bg-background" required />
      </Field>
      <Field label="Avatar (optional)" description="PNG, JPEG, GIF, WebP or SVG, at most 1 MB.">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AvatarBox src={avatar} name={n} className="size-10" />
            {avatar && (
              <button
                type="button"
                aria-label="Remove avatar"
                onClick={() => void run(() => A.removeAvatar(), { onSuccess: () => router.refresh() })}
                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("file", f);
              void run(() => A.uploadAvatar(fd), { onSuccess: () => router.refresh() });
              ev.target.value = "";
            }}
          />
          <Button type="button" variant="outline" disabled={pending} onClick={() => file.current?.click()}>
            <Upload /> Upload image
          </Button>
        </div>
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" disabled={!dirty || pending} variant={dirty ? "default" : "secondary"}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System preference", icon: Laptop },
];

export function AppearancePicker({ saved }: { saved: ThemePreference }) {
  const [pref, setPref] = useTheme();
  const [, run] = useAction();
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid gap-3 sm:grid-cols-3">
      {THEMES.map((t) => {
        const active = pref === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setPref(t.value);
              if (t.value !== saved) void run(() => A.saveAppearance(t.value));
            }}
            className={cn("flex items-center gap-3 rounded-lg border bg-background p-3 text-left text-sm transition-colors hover:bg-muted", active && "border-foreground ring-1 ring-foreground")}
          >
            <span className={cn("flex size-8 items-center justify-center rounded-md border", t.value === "dark" ? "bg-neutral-900 text-white" : t.value === "light" ? "bg-white text-neutral-900" : "bg-gradient-to-br from-white to-neutral-900 text-neutral-500")}>
              <t.icon className="size-4" />
            </span>
            <span className="font-medium">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [pending, run] = useAction();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = again.length > 0 && again !== next;
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void run(() => A.changePassword({ current: cur, next }), {
          onSuccess: () => {
            setCur("");
            setNext("");
            setAgain("");
          },
        });
      }}
      className="space-y-4"
    >
      {hasPassword ? (
        <Field label="Current password" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} className="h-10 bg-background" required />
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">Your account has no password yet. Set one to log in with your email.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" description="At least 8 characters." htmlFor="pw-next">
          <Input id="pw-next" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} className="h-10 bg-background" required />
        </Field>
        <Field label="Confirm new password" description={mismatch ? <span className="text-destructive">Passwords don&apos;t match.</span> : "Type it again."} htmlFor="pw-again">
          <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="h-10 bg-background" aria-invalid={mismatch} required />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || next.length < 8 || next !== again || (hasPassword && !cur)}>
          {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </Button>
      </div>
    </form>
  );
}

const KINDS = NOTIFICATION_KINDS;
const CHANNELS = NOTIFICATION_CHANNELS;

export function NotificationsMatrix({ prefs }: { prefs: NotificationPrefs }) {
  const [state, setState] = useState(() => withDefaults(prefs));
  const [, run] = useAction();
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Inbox item</TableHead>
            {CHANNELS.map(([, label]) => (
              <TableHead key={label} className="w-24 text-center">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {KINDS.map((k) => (
            <TableRow key={k.key}>
              <TableCell className="pl-4">
                <div className="font-medium">{k.label}</div>
                <div className="text-xs text-muted-foreground">{k.hint}</div>
              </TableCell>
              {CHANNELS.map(([ch, label]) => (
                <TableCell key={ch} className="text-center">
                  <Checkbox
                    aria-label={`${k.label} by ${label}`}
                    className="mx-auto"
                    checked={state[k.key][ch]}
                    onCheckedChange={(v) => {
                      const row = { ...state[k.key], [ch]: Boolean(v) };
                      setState({ ...state, [k.key]: row });
                      void run(() => A.saveNotifications({ [k.key]: row }));
                    }}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function DigestForm({ digest }: { digest?: Partial<DigestPrefs> }) {
  const [state, setState] = useState<DigestPrefs>({ daily: false, hourUtc: 8, channels: ["email"], only: false, ...digest });
  const [, run] = useAction();
  const save = (patch: Partial<DigestPrefs>) => {
    const next = { ...state, ...patch };
    setState(next);
    void run(() => A.saveDigest(patch));
  };
  return (
    <div className="space-y-4 rounded-lg border bg-background p-4">
      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="block font-medium">Daily digest</span>
          <span className="block text-xs text-muted-foreground">One message a day with every decision waiting on you.</span>
        </span>
        <Switch aria-label="Daily digest" checked={state.daily} onCheckedChange={(v) => save({ daily: Boolean(v) })} />
      </label>
      <div className={cn("space-y-4", !state.daily && "pointer-events-none opacity-50")}>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium">Send at (UTC)</span>
          <Select value={String(state.hourUtc)} onValueChange={(v) => save({ hourUtc: Number(v) })} disabled={!state.daily}>
            <SelectTrigger aria-label="Digest hour (UTC)" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium">Channels</span>
          <span className="flex gap-4">
            {CHANNELS.map(([ch, label]) => (
              <label key={ch} className="flex items-center gap-2">
                <Checkbox
                  aria-label={`Digest by ${label}`}
                  disabled={!state.daily}
                  checked={state.channels.includes(ch)}
                  onCheckedChange={(v) => {
                    const channels = v ? [...new Set([...state.channels, ch])] : state.channels.filter((c) => c !== ch);
                    if (channels.length) save({ channels });
                  }}
                />
                {label}
              </label>
            ))}
          </span>
        </div>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="block font-medium">Digest only</span>
            <span className="block text-xs text-muted-foreground">Skip the messages above and get only the daily digest.</span>
          </span>
          <Switch aria-label="Digest only" disabled={!state.daily} checked={state.only} onCheckedChange={(v) => save({ only: Boolean(v) })} />
        </label>
      </div>
    </div>
  );
}

export function NotificationHistory({ items }: { items: NotificationRecord[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Nothing sent yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">When</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((n) => (
            <TableRow key={n.id}>
              <TableCell className="pl-4 whitespace-nowrap text-muted-foreground">{new Date(n.at).toLocaleString()}</TableCell>
              <TableCell>{notificationLabel(n.kind)}</TableCell>
              <TableCell className="capitalize">{n.channel}</TableCell>
              <TableCell>
                <Badge variant={n.status === "sent" ? "secondary" : "destructive"} title={n.error}>
                  {n.status}
                </Badge>
                {n.error && <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{n.error}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function LinkedAccounts({ accounts }: { accounts: LinkedAccount[] }) {
  const [linking, setLinking] = useState<LinkProvider>();
  return (
    <div>
      {(Object.keys(LINK_META) as LinkProvider[]).map((p) => {
        const meta = LINK_META[p]!;
        const acc = accounts.find((a) => a.provider === p);
        return (
          <div key={p} className="flex items-center gap-4 py-2.5 [&+&]:border-t">
            <span className="flex size-8 items-center justify-center rounded-md border bg-background">
              <meta.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{meta.name}</div>
              <div className="truncate text-sm text-muted-foreground">{acc ? (acc.handle ? `${acc.handle} · ${acc.externalId}` : acc.externalId) : "Not linked"}</div>
            </div>
            {acc ? (
              <>
                <ConnectedBadge>Linked</ConnectedBadge>
                <ConfirmAction
                  title={`Unlink ${meta.name}?`}
                  description={`Kiln will no longer recognize you in ${meta.name}. Replies and gate decisions from that account will not count as yours.`}
                  confirmLabel="Unlink"
                  action={() => A.unlinkAccount(p)}
                  trigger={(open) => (
                    <Button variant="ghost" size="icon-sm" aria-label={`Unlink ${meta.name}`} onClick={open} className="text-destructive hover:text-destructive">
                      <Trash2 />
                    </Button>
                  )}
                />
              </>
            ) : (
              <Button variant="outline" onClick={() => setLinking(p)}>
                Link
              </Button>
            )}
          </div>
        );
      })}
      <LinkDialog provider={linking} onClose={() => setLinking(undefined)} />
    </div>
  );
}

function LinkDialog({ provider, onClose }: { provider?: LinkProvider; onClose: () => void }) {
  const [pending, run] = useAction();
  const [id, setId] = useState("");
  const [handle, setHandle] = useState("");
  const meta = provider ? LINK_META[provider] : undefined;
  return (
    <Dialog
      open={Boolean(provider)}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setId("");
          setHandle("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!provider) return;
            void run(() => A.linkAccount({ provider, externalId: id, handle }), {
              onSuccess: () => {
                onClose();
                setId("");
                setHandle("");
              },
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Link {meta?.name}</DialogTitle>
            <DialogDescription>Kiln uses this to know it is you when you mention the factory or reply in {meta?.name}.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{meta?.idLabel}</span>
            <Input value={id} onChange={(e) => setId(e.target.value)} required autoFocus className="h-9" />
            <span className="text-xs text-muted-foreground">{meta?.idHint}</span>
          </label>
          {meta?.handle && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{meta.handle} (optional)</span>
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} className="h-9" />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !id.trim()}>
              {pending ? "Linking…" : "Link account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const KEY_TYPES = [
  { value: "personal", label: "Personal", hint: "Acts as you, with your roles. Usage counts as yours." },
  { value: "agent", label: "Agent", hint: "A team service account: read and send on the team's factories. Never decides or merges." },
  { value: "worker", label: "Self-hosted worker", hint: "For a worker that runs sandboxes on your own machines. No API access." },
] as const;
const EXPIRY = [
  { value: "1d", label: "1 day" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "never", label: "Never" },
] as const;

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function ApiKeys({ keys, canTeamKeys, me }: { keys: ApiKeyRow[]; canTeamKeys: boolean; me: string }) {
  const [open, setOpen] = useState(false);
  const live = keys.filter((k) => !k.revoked);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Use keys with the Kiln CLI, the SDKs, the API and the MCP server. A key is shown once, when you create it.</p>
        <Button onClick={() => setOpen(true)}>
          <Plus /> Generate new key
        </Button>
      </div>
      {live.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-background px-4 py-8 text-center text-sm text-muted-foreground">No API keys yet.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2 font-medium">
                      <KeyRound className="size-3.5 text-muted-foreground" />
                      {k.name}
                    </div>
                    {k.subject !== me && <div className="text-xs text-muted-foreground">{k.subject}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {k.type === "worker" ? "Worker" : (k.type ?? "personal")}
                    </Badge>
                    {(k.type === "agent" || k.type === "worker") && (
                      <Badge variant="secondary" className="ml-1">
                        Team
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{when(k.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{k.expiresAt ? when(k.expiresAt) : "Never"}</TableCell>
                  <TableCell className="text-muted-foreground">{k.lastUsedAt ? when(k.lastUsedAt) : "Never"}</TableCell>
                  <TableCell>
                    <ConfirmAction
                      title={`Revoke ${k.name}?`}
                      description="Anything using this key stops working right away. This cannot be undone."
                      confirmLabel="Revoke"
                      action={() => A.revokeApiKey(k.id)}
                      trigger={(o) => (
                        <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${k.name}`} onClick={o} className="text-muted-foreground hover:text-destructive">
                          <Trash2 />
                        </Button>
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <NewKeyDialog open={open} onOpenChange={setOpen} canTeamKeys={canTeamKeys} />
    </div>
  );
}

function NewKeyDialog({ open, onOpenChange, canTeamKeys }: { open: boolean; onOpenChange: (o: boolean) => void; canTeamKeys: boolean }) {
  const [pending, run] = useAction();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof KEY_TYPES)[number]["value"]>("personal");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]["value"]>("30d");
  const [token, setToken] = useState<string>();
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setToken(undefined);
      setName("");
      setType("personal");
      setExpiry("30d");
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {token ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>This is the only time Kiln shows it. Store it somewhere safe, such as a password manager or your CI secrets.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
              <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{token}</code>
              <CopyButton value={token} />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => A.createApiKey({ name, type, expiresIn: expiry }), { onSuccess: (d) => d && setToken(d.token) });
            }}
          >
            <DialogHeader>
              <DialogTitle>Generate new key</DialogTitle>
            </DialogHeader>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" required autoFocus className="h-9" />
            </label>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Type</span>
              <div role="radiogroup" className="grid gap-2">
                {KEY_TYPES.map((t) => {
                  const disabled = t.value !== "personal" && !canTeamKeys;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={type === t.value}
                      disabled={disabled}
                      onClick={() => setType(t.value)}
                      className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50", type === t.value && "border-foreground ring-1 ring-foreground")}
                    >
                      <div className="text-sm font-medium">
                        {t.label}
                        {t.value !== "personal" && <span className="ml-2 text-xs font-normal text-muted-foreground">Team owners and admins</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Expires</span>
              <Select items={EXPIRY.map((e) => ({ value: e.value, label: e.label }))} value={expiry} onValueChange={(v) => v && setExpiry(v as typeof expiry)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Generating…" : "Generate key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
