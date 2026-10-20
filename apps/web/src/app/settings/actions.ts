"use server";

import { revalidatePath } from "next/cache";
import type { Appearance, LinkProvider, NotificationPrefs } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api } from "@/lib/kiln";

const done = () => revalidatePath("/", "layout");

export async function updateProfile(input: { name: string; email: string }): Promise<ActionResult> {
  const r = await attempt(() => api.updateMe({ name: input.name.trim(), email: input.email.trim() }), "Profile saved");
  if (r.ok) done();
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function uploadAvatar(form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image." };
  if (file.size > 1024 * 1024) return { ok: false, error: "Use an image of at most 1 MB." };
  const r = await attempt(async () => api.uploadAvatar(new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream"), "Avatar updated");
  if (r.ok) done();
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function removeAvatar(): Promise<ActionResult> {
  const r = await attempt(() => api.updateMe({ avatar: null }), "Avatar removed");
  if (r.ok) done();
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function saveAppearance(appearance: Appearance): Promise<ActionResult> {
  const r = await attempt(() => api.updateMe({ appearance }));
  return r.ok ? { ok: true } : r;
}

export async function changePassword(input: { current?: string; next: string }): Promise<ActionResult> {
  if (input.next.length < 8) return { ok: false, error: "Use at least 8 characters." };
  const r = await attempt(() => api.changePassword(input.next, input.current || undefined), "Password changed");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function saveNotifications(prefs: Partial<NotificationPrefs>): Promise<ActionResult> {
  const r = await attempt(() => api.updateMe({ notifications: prefs }));
  if (r.ok) revalidatePath("/settings");
  return r.ok ? { ok: true } : r;
}

export async function linkAccount(input: { provider: LinkProvider; externalId: string; handle?: string }): Promise<ActionResult> {
  const r = await attempt(() => api.linkAccount(input.provider, input.externalId.trim(), input.handle?.trim() || undefined), "Account linked");
  if (r.ok) revalidatePath("/settings");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function unlinkAccount(provider: LinkProvider): Promise<ActionResult> {
  const r = await attempt(() => api.unlinkAccount(provider), "Account unlinked");
  if (r.ok) revalidatePath("/settings");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function createApiKey(input: { name: string; type: "personal" | "agent" | "worker"; expiresIn: "1d" | "30d" | "90d" | "never" }): Promise<ActionResult<{ token: string }>> {
  const r = await attempt(() => api.createApiKey(input));
  if (!r.ok) return r;
  revalidatePath("/settings");
  return { ok: true, data: { token: r.data!.token } };
}

export async function revokeApiKey(id: string): Promise<ActionResult> {
  const r = await attempt(() => api.revokeApiKey(id), "Key revoked");
  if (r.ok) revalidatePath("/settings");
  return r.ok ? { ok: true, message: r.message } : r;
}
