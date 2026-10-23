"use server";

import { revalidatePath } from "next/cache";
import { KilnApiError, type KilnClient } from "@kiln/sdk-ts";
import { attempt, type ActionResult } from "@/lib/action-result";
import { api, errorMessage } from "@/lib/kiln";

type StartResult = Awaited<ReturnType<KilnClient["startConnection"]>>;

/** An API without the connections routes answers 404 with a plain-text body. */
const unavailable = (err: unknown) => err instanceof SyntaxError || (err instanceof KilnApiError && err.status === 404 && /returned 404|not found/i.test(err.message));

export async function startConnect(provider: string): Promise<ActionResult<StartResult>> {
  try {
    return { ok: true, data: await api.startConnection(provider) };
  } catch (err) {
    if (unavailable(err)) return { ok: false, error: "This Kiln server can't connect from the browser yet. Use the environment variables in Configure." };
    return { ok: false, error: errorMessage(err) };
  }
}

/** Kiln's own GitHub App: the manifest and where the browser posts it. */
export async function createGitHubApp(org: string): Promise<ActionResult<{ action: string; manifest: Record<string, unknown> }>> {
  try {
    const r = await api.githubAppManifest(org.trim() ? { org: org.trim() } : {});
    return { ok: true, data: { action: r.action, manifest: r.manifest } };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function removeGitHubApp(slug: string): Promise<ActionResult> {
  const r = await attempt(() => api.removeGitHubApp(slug), `Removed ${slug}`);
  if (r.ok) revalidatePath("/integrations");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function completeConnect(provider: string, state: string, params: Record<string, string>): Promise<ActionResult> {
  const r = await attempt(() => api.completeConnection(provider, { state, params }), "Connected");
  if (r.ok) revalidatePath("/integrations");
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function testConnect(provider: string): Promise<ActionResult> {
  try {
    const t = await api.testConnection(provider);
    revalidatePath("/integrations");
    return t.ok ? { ok: true, message: t.message || "Connection works" } : { ok: false, error: t.message || "The test failed" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function disconnectProvider(provider: string, name: string): Promise<ActionResult> {
  const r = await attempt(() => api.disconnect(provider), `Disconnected ${name}`);
  if (r.ok) revalidatePath("/integrations");
  return r.ok ? { ok: true, message: r.message } : r;
}
