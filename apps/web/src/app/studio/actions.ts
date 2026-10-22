"use server";

import { z } from "zod";
import { api } from "@/lib/kiln";
import { API_BASE, apiHeaders } from "@/lib/proxy";
import {
  ApplyResult,
  Chat,
  ChatDetail,
  ChatMode,
  Diff,
  NewChatResult,
  Preview,
  AppSource,
  StudioApp,
  SendResult,
  ShipMode,
  StatusReport,
  Version,
} from "@/lib/studio/types";

/** What every Studio action returns: the parsed response, or the API's message and status. */
export type StudioResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const Id = z.string().regex(/^s[pcvt]_[A-Za-z0-9_-]+$/);

/** Calls one Studio route as the signed-in user and parses the response with its schema. */
async function call<S extends z.ZodType>(schema: S, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<StudioResult<z.infer<S>>> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/studio${path}`, {
      method,
      headers: await apiHeaders(body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg =
        (json as { message?: string; error?: string } | undefined)?.message ??
        (json as { error?: string } | undefined)?.error ??
        `Studio API answered ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, error: `Unexpected Studio response: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 503 };
  }
}

function id(v: string): string {
  return Id.parse(v);
}

const CreateInput = z.object({
  name: z.string().trim().min(1).max(80),
  source: AppSource.optional(),
  shipMode: ShipMode.optional(),
  harness: z.string().optional(),
  model: z.string().optional(),
});
const PatchInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  shipMode: ShipMode.optional(),
  devCommand: z.string().max(200).nullable().optional(),
});
const ChatInput = z.object({
  prompt: z.string().optional(),
  mode: ChatMode.optional(),
  harness: z.string().optional(),
  model: z.string().optional(),
  title: z.string().optional(),
});
const SendInput = z.object({ text: z.string().trim().min(1), mode: ChatMode.optional() });

export async function studioProjects() {
  return call(z.object({ projects: z.array(StudioApp) }), "GET", "/projects");
}
export async function studioCreateProject(input: z.input<typeof CreateInput>) {
  return call(StudioApp, "POST", "/projects", CreateInput.parse(input));
}
export async function studioProject(projectId: string) {
  return call(z.object({ project: StudioApp, chats: z.array(Chat), versions: z.array(Version) }), "GET", `/projects/${id(projectId)}`);
}
export async function studioUpdateProject(projectId: string, patch: z.input<typeof PatchInput>) {
  return call(StudioApp, "PATCH", `/projects/${id(projectId)}`, PatchInput.parse(patch));
}
export async function studioNewChat(projectId: string, input: z.input<typeof ChatInput>) {
  return call(NewChatResult, "POST", `/projects/${id(projectId)}/chats`, ChatInput.parse(input));
}
export async function studioChat(chatId: string) {
  return call(ChatDetail, "GET", `/chats/${id(chatId)}`);
}
export async function studioSend(chatId: string, input: z.input<typeof SendInput>) {
  return call(SendResult, "POST", `/chats/${id(chatId)}/messages`, SendInput.parse(input));
}
export async function studioApply(chatId: string) {
  return call(ApplyResult, "POST", `/chats/${id(chatId)}/apply`);
}
export async function studioChatDiff(chatId: string) {
  return call(Diff, "GET", `/chats/${id(chatId)}/diff`);
}
export async function studioChatPreview(chatId: string) {
  return call(Preview, "GET", `/chats/${id(chatId)}/preview`);
}
export async function studioRestore(versionId: string) {
  return call(Version, "POST", `/versions/${id(versionId)}/restore`);
}
export async function studioBookmark(versionId: string, on: boolean) {
  return call(Version, "POST", `/versions/${id(versionId)}/bookmark`, { on: z.boolean().parse(on) });
}
export async function studioVersionDiff(versionId: string) {
  return call(Diff, "GET", `/versions/${id(versionId)}/diff`);
}
export async function studioVersionPreview(versionId: string) {
  return call(Preview, "GET", `/versions/${id(versionId)}/preview`);
}
export async function studioStatus() {
  return call(StatusReport, "GET", "/status");
}
export async function studioRepositories(): Promise<StudioResult<{ owner: string; name: string; forge: string }[]>> {
  try {
    return { ok: true, data: (await api.forgeRepositories()).repositories };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const SecretName = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

/** An imported app's missing env, saved as team secrets (the existing secrets API). */
export async function studioSaveSecrets(values: Record<string, string>): Promise<StudioResult<null>> {
  try {
    const pairs = z.record(SecretName, z.string().min(1)).parse(values);
    for (const [name, value] of Object.entries(pairs)) await api.createManagedSecret({ scope: "team", name, value });
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
