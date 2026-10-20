"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Ellipsis, Mail, Plus, RotateCw, Trash2, Upload, UserMinus, X } from "lucide-react";
import type { FactoryMemberRow, FactoryRole, InviteRow, TeamMemberRow, TeamRole } from "@kiln/sdk-ts";
import { ConfirmAction, CopyButton } from "@/components/kiln/confirm-action";
import { AvatarBox, Field } from "@/components/kiln/settings-blocks";
import { SimpleSelect } from "@/components/kiln/simple-select";
import { useAction } from "@/components/kiln/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import * as A from "./actions";

const TEAM_ROLES: { value: TeamRole; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including ownership" },
  { value: "admin", label: "Admin", hint: "Members, settings, keys and secrets" },
  { value: "member", label: "Member", hint: "Use the team's factories" },
];

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function GeneralForm({ team, canEdit }: { team: { id: string; name: string; slug: string; avatar?: string; createdAt: string }; canEdit: boolean }) {
  const [name, setName] = useState(team.name);
  const [slug, setSlug] = useState(team.slug);
  const [pending, run] = useAction();
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const dirty = name.trim() !== team.name || slug.trim() !== team.slug;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => A.updateTeam(team.id, { name: name.trim(), slug: slug.trim() }), { onSuccess: () => router.refresh() });
      }}
    >
      <Field label="Team name" description="Shown in the account menu and on invites." meta={`Created ${day(team.createdAt)}`} htmlFor="team-name">
        <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className="h-10 bg-background" required />
      </Field>
      <Field label="Slug" description={<>Use it with the API and CLI, e.g. <code className="font-mono text-xs">X-Kiln-Team: {slug || "slug"}</code>.</>} htmlFor="team-slug">
        <Input id="team-slug" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!canEdit} pattern="[a-z0-9-]+" className="h-10 bg-background font-mono" required />
      </Field>
      <Field label="Add an avatar (optional)" description="Used in the team switcher and on invite pages.">
        <div className="flex items-center gap-3">
          <div className="relative">
            <AvatarBox src={team.avatar} name={name} square className="size-10 rounded-lg bg-[#1d3b2a] text-white" />
            {team.avatar && canEdit && (
              <button type="button" aria-label="Remove avatar" onClick={() => void run(() => A.removeTeamAvatar(team.id), { onSuccess: () => router.refresh() })} className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </div>
          {canEdit && (
            <>
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData();
                  fd.set("file", f);
                  void run(() => A.uploadTeamAvatar(team.id, fd), { onSuccess: () => router.refresh() });
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" disabled={pending} onClick={() => file.current?.click()}>
                <Upload /> Upload image
              </Button>
            </>
          )}
        </div>
      </Field>
      {canEdit && (
        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}

export function MembersTable({ team, members, me, myRole }: { team: string; members: TeamMemberRow[]; me?: string; myRole?: TeamRole }) {
  const [, run] = useAction();
  const router = useRouter();
  const canEdit = myRole === "owner" || myRole === "admin";
  const owners = members.filter((m) => m.role === "owner").length;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Member</TableHead>
            <TableHead className="w-44">Role</TableHead>
            <TableHead className="w-32">Joined</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const self = m.userId === me;
            const name = m.user?.name ?? m.userId;
            // Only owners touch owners; nobody demotes the last owner.
            const locked = !canEdit || (m.role === "owner" && myRole !== "owner") || (m.role === "owner" && owners <= 1);
            const roles = myRole === "owner" ? TEAM_ROLES : TEAM_ROLES.filter((r) => r.value !== "owner");
            return (
              <TableRow key={m.userId}>
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <AvatarBox src={m.user?.avatar} name={name} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {name}
                        {self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{m.user?.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {locked ? (
                    <Badge variant="outline" className="capitalize">
                      {m.role}
                    </Badge>
                  ) : (
                    <SimpleSelect size="sm" ariaLabel={`Role of ${name}`} value={m.role} options={roles} onChange={(v) => void run(() => A.setMemberRole(team, m.userId, v as TeamRole), { onSuccess: () => router.refresh() })} />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{day(m.joinedAt)}</TableCell>
                <TableCell>
                  {canEdit && !self && !(m.role === "owner" && myRole !== "owner") && (
                    <MemberMenu team={team} member={m} name={name} me={me} myRole={myRole} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function MemberMenu({ team, member, name, me, myRole }: { team: string; member: TeamMemberRow; name: string; me?: string; myRole?: TeamRole }) {
  const [confirm, setConfirm] = useState<"remove" | "transfer">();
  const router = useRouter();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {myRole === "owner" && member.role !== "owner" && me && (
            <DropdownMenuItem onClick={() => setConfirm("transfer")}>
              <Crown /> Transfer ownership
            </DropdownMenuItem>
          )}
          {myRole === "owner" && member.role !== "owner" && <DropdownMenuSeparator />}
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("remove")}>
            <UserMinus /> Remove from team
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirm === "remove"}
        onOpenChange={(o) => !o && setConfirm(undefined)}
        title={`Remove ${name}?`}
        description="They lose access to this team's factories, secrets and keys right away. Their personal API keys for this team stop working."
        confirmLabel="Remove"
        action={() => A.removeMember(team, member.userId)}
        onDone={() => router.refresh()}
      />
      {me && (
        <ConfirmAction
          open={confirm === "transfer"}
          onOpenChange={(o) => !o && setConfirm(undefined)}
          title={`Make ${name} the owner?`}
          description="They become an owner of this team and you step down to admin. Only an owner can undo this."
          confirmLabel="Transfer ownership"
          destructive={false}
          action={() => A.transferOwnership(team, member.userId, me)}
          onDone={() => router.refresh()}
        />
      )}
    </>
  );
}

export function Invites({ team, invites, canInvite, isOwner }: { team: string; invites: InviteRow[]; canInvite: boolean; isOwner: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [link, setLink] = useState<{ email: string; link: string }>();
  const [pending, run] = useAction();
  const router = useRouter();
  const pendingInvites = invites.filter((i) => i.status === "pending");
  const roles = isOwner ? TEAM_ROLES : TEAM_ROLES.filter((r) => r.value !== "owner");
  return (
    <div>
      {canInvite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim();
            void run(() => A.invite(team, to, role), {
              onSuccess: (d) => {
                if (d) setLink({ email: to, link: d.link });
                setEmail("");
                router.refresh();
              },
            });
          }}
        >
          <label className="grid min-w-60 flex-1 gap-1.5">
            <span className="text-sm font-semibold">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required className="h-9 bg-background" />
          </label>
          <label className="grid w-40 gap-1.5">
            <span className="text-sm font-semibold">Role</span>
            <SimpleSelect value={role} onChange={(v) => setRole(v as TeamRole)} options={roles} className="h-9" ariaLabel="Invite role" />
          </label>
          <Button type="submit" disabled={pending || !email.trim()} className="h-9">
            <Mail /> {pending ? "Inviting…" : "Invite"}
          </Button>
        </form>
      )}
      <div className={canInvite ? "mt-5" : ""}>
        {pendingInvites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-4 font-medium">{i.email}</TableCell>
                    <TableCell className="capitalize">{i.role}</TableCell>
                    <TableCell className={i.expired ? "text-destructive" : "text-muted-foreground"}>{i.expired ? "Expired" : day(i.expiresAt)}</TableCell>
                    <TableCell>
                      {canInvite && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Resend invite to ${i.email}`}
                            title="Resend (new link, 7 more days)"
                            onClick={() => void run(() => A.resendInvite(team, i.id), { onSuccess: (d) => d && setLink({ email: i.email, link: d.link }) })}
                          >
                            <RotateCw />
                          </Button>
                          <ConfirmAction
                            title={`Revoke the invite for ${i.email}?`}
                            description="The link stops working. You can invite them again later."
                            confirmLabel="Revoke"
                            action={() => A.revokeInvite(team, i.id)}
                            onDone={() => router.refresh()}
                            trigger={(open) => (
                              <Button variant="ghost" size="icon-sm" aria-label={`Revoke invite for ${i.email}`} onClick={open} className="text-muted-foreground hover:text-destructive">
                                <Trash2 />
                              </Button>
                            )}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <Dialog open={Boolean(link)} onOpenChange={(o) => !o && setLink(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share the invite link</DialogTitle>
            <DialogDescription>Send this link to {link?.email}. It works for 7 days, and Kiln only shows it now. Resend to get a new one.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
            <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">{link?.link}</code>
            <CopyButton value={link?.link ?? ""} label="Copy link" />
          </div>
          <DialogFooter>
            <Button onClick={() => setLink(undefined)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const FACTORY_ROLES: { value: FactoryRole; label: string }[] = [
  { value: "user", label: "User" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

/** Per-factory role grants on top of the team's default factory role. */
export function FactoryMembers({ factory, rows, members, canEdit }: { factory: { id: string; name: string }; rows: FactoryMemberRow[]; members: TeamMemberRow[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<FactoryRole>("editor");
  const [, run] = useAction();
  const router = useRouter();
  const explicit = rows.filter((r) => r.source === "factory");
  const candidates = members.filter((m) => m.role === "member" && !explicit.some((e) => e.userId === m.userId));
  return (
    <div className="rounded-lg border bg-background p-4 [&+&]:mt-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-[5px] bg-[#1d3b2a] text-[10px] font-semibold text-white uppercase">{factory.name.slice(0, 1)}</span>
        <span className="flex-1 text-sm font-semibold">{factory.name}</span>
        <span className="text-xs text-muted-foreground">
          {rows.filter((r) => r.role === "admin").length} admin · {rows.filter((r) => r.role === "editor").length} editor · {rows.filter((r) => r.role === "user").length} user
        </span>
        {canEdit && candidates.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>
            <Plus /> Grant role
          </Button>
        )}
      </div>
      {explicit.length > 0 && (
        <ul className="mt-3 space-y-2">
          {explicit.map((r) => (
            <li key={r.userId} className="flex items-center gap-3 text-sm">
              <AvatarBox src={r.user?.avatar} name={r.user?.name ?? r.userId} className="size-6 text-xs" />
              <span className="min-w-0 flex-1 truncate">{r.user?.name ?? r.userId}</span>
              {canEdit ? (
                <>
                  <SimpleSelect size="sm" className="w-28" value={r.role} options={FACTORY_ROLES} ariaLabel="Factory role" onChange={(v) => void run(() => A.setFactoryRole(factory.id, r.userId, v as FactoryRole), { onSuccess: () => router.refresh() })} />
                  <Button variant="ghost" size="icon-sm" aria-label="Remove factory role" onClick={() => void run(() => A.removeFactoryMember(factory.id, r.userId), { onSuccess: () => router.refresh() })} className="text-muted-foreground hover:text-destructive">
                    <X />
                  </Button>
                </>
              ) : (
                <Badge variant="outline" className="capitalize">
                  {r.role}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <SimpleSelect size="sm" className="w-56" value={who} placeholder="Choose a member" options={candidates.map((c) => ({ value: c.userId, label: c.user?.name ?? c.userId }))} onChange={setWho} ariaLabel="Member" />
          <SimpleSelect size="sm" className="w-28" value={role} options={FACTORY_ROLES} onChange={(v) => setRole(v as FactoryRole)} ariaLabel="Role" />
          <Button
            size="sm"
            disabled={!who}
            onClick={() =>
              void run(() => A.addFactoryMember(factory.id, who, role), {
                onSuccess: () => {
                  setAdding(false);
                  setWho("");
                  router.refresh();
                },
              })
            }
          >
            Grant
          </Button>
        </div>
      )}
    </div>
  );
}
