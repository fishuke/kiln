"use server";

import { revalidatePath } from "next/cache";
import type { FactoryRole, ModelKeyProvider, TeamRole, TeamSettings } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";
import { setTeam } from "@/lib/web-session";
import { CLAUDE_TOKEN_SECRET } from "./constants";

const refresh = (all = false) => revalidatePath(all ? "/" : "/team", all ? "layout" : "page");
const plain = (r: ActionResult<unknown>): ActionResult => (r.ok ? { ok: true, message: r.message } : r);

export async function updateTeam(team: string, patch: { name?: string; slug?: string }): Promise<ActionResult> {
  const r = await attempt(() => api.updateTeam(team, patch), "Team saved");
  if (r.ok) refresh(true);
  return plain(r);
}

export async function uploadTeamAvatar(team: string, form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image." };
  if (file.size > 1024 * 1024) return { ok: false, error: "Use an image of at most 1 MB." };
  const r = await attempt(async () => api.uploadTeamAvatar(team, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream"), "Avatar updated");
  if (r.ok) refresh(true);
  return plain(r);
}

export async function removeTeamAvatar(team: string): Promise<ActionResult> {
  const r = await attempt(() => api.updateTeam(team, { avatar: null }), "Avatar removed");
  if (r.ok) refresh(true);
  return plain(r);
}

export async function createTeam(name: string): Promise<ActionResult<{ id: string }>> {
  const r = await attempt(() => api.createTeam({ name: name.trim() }));
  if (!r.ok) return r;
  await setTeam(r.data!.id);
  refresh(true);
  return { ok: true, message: `Created ${r.data!.name}`, data: { id: r.data!.id } };
}

export async function setMemberRole(team: string, userId: string, role: TeamRole): Promise<ActionResult> {
  const r = await attempt(() => api.setTeamRole(team, userId, role), "Role updated");
  if (r.ok) refresh(true);
  return plain(r);
}

/** Makes someone an owner, then steps the current owner down to admin. */
export async function transferOwnership(team: string, userId: string, myUserId: string): Promise<ActionResult> {
  const r = await attempt(async () => {
    await api.setTeamRole(team, userId, "owner");
    await api.setTeamRole(team, myUserId, "admin");
  }, "Ownership transferred");
  if (r.ok) refresh(true);
  return plain(r);
}

export async function removeMember(team: string, userId: string, self = false): Promise<ActionResult> {
  const r = await attempt(() => api.removeTeamMember(team, userId), self ? "You left the team" : "Member removed");
  if (r.ok) refresh(true);
  return plain(r);
}

export async function invite(team: string, email: string, role: TeamRole): Promise<ActionResult<{ link: string }>> {
  const r = await attempt(() => api.inviteMember(team, email.trim(), role));
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: `Invite created for ${email.trim()}`, data: { link: r.data!.link } };
}

export async function resendInvite(team: string, inviteId: string): Promise<ActionResult<{ link: string }>> {
  const r = await attempt(() => api.resendInvite(team, inviteId));
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "New invite link issued", data: { link: r.data!.link } };
}

export async function revokeInvite(team: string, inviteId: string): Promise<ActionResult> {
  const r = await attempt(() => api.revokeInvite(team, inviteId), "Invite revoked");
  if (r.ok) refresh();
  return plain(r);
}

export async function updateSettings(team: string, patch: Partial<TeamSettings>, message = "Settings saved"): Promise<ActionResult> {
  const r = await attempt(() => api.updateTeamSettings(team, patch), message);
  if (r.ok) refresh(true);
  return plain(r);
}

export async function setModelKey(team: string, provider: ModelKeyProvider, value: string | Record<string, string>): Promise<ActionResult> {
  const r = await attempt(() => api.setModelKey(team, provider, value), "Key saved");
  if (r.ok) refresh();
  return plain(r);
}

export async function deleteModelKey(team: string, provider: ModelKeyProvider): Promise<ActionResult> {
  const r = await attempt(() => api.deleteModelKey(team, provider), "Key removed");
  if (r.ok) refresh();
  return plain(r);
}

/** The Claude subscription token is a typed team secret; Claude Code runs pick it up automatically. */
export async function deleteClaudeToken(name: string = CLAUDE_TOKEN_SECRET): Promise<ActionResult> {
  const r = await attempt(() => api.deleteManagedSecret("team", name), "Token removed");
  if (r.ok) refresh();
  return plain(r);
}

/** Another subscription token in the team's pool (a teammate's `claude setup-token`). */
export async function addClaudeToken(name: string, value: string): Promise<ActionResult> {
  const r = await attempt(() => api.createManagedSecret({ scope: "team", name: name.trim(), type: "claude_oauth_token", value: value.trim(), description: "Claude subscription token from `claude setup-token`" }), "Token added");
  if (r.ok) refresh();
  return plain(r);
}

/** One minimal run with the token: whether it works and how much of its windows is used. */
export async function checkClaudeToken(team: string, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.checkClaudeToken(team, name));
  if (r.ok) refresh();
  if (!r.ok) return r;
  const e = r.data!;
  return e.status === "invalid" ? { ok: false, error: `${name} was rejected: ${e.error ?? "invalid token"}` } : { ok: true, message: `${name} works${e.fiveHour ? `, ${Math.round(e.fiveHour.utilization * 100)}% of its 5-hour window used` : ""}` };
}

export async function addFactoryMember(factory: string, userId: string, role: FactoryRole): Promise<ActionResult> {
  const r = await attempt(() => api.addFactoryMember(factory, { userId, role }), "Factory role set");
  if (r.ok) refresh();
  return plain(r);
}

export async function setFactoryRole(factory: string, userId: string, role: FactoryRole): Promise<ActionResult> {
  const r = await attempt(() => api.setFactoryRole(factory, userId, role), "Factory role updated");
  if (r.ok) refresh();
  return plain(r);
}

export async function removeFactoryMember(factory: string, userId: string): Promise<ActionResult> {
  const r = await attempt(() => api.removeFactoryMember(factory, userId), "Factory role removed");
  if (r.ok) refresh();
  return plain(r);
}
