"use server";

import { KilnApiError } from "@kiln/sdk-ts";
import { z } from "zod";
import { api, errorMessage } from "@/lib/kiln";
import {
  MergeReview,
  AppPullRequest,
  ApplyResult,
  AppSource,
  Chat,
  ChatDetail,
  ChatMode,
  Diff,
  NewChatResult,
  Preview,
  SendResult,
  ShipMode,
  StatusReport,
  StudioApp,
  Version,
} from "@/lib/studio/types";

/** What every Studio action returns: the parsed response, or the API's message and status. */
export type StudioResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** Runs one SDK call as the signed-in user and parses the response with its schema. */
async function call<S extends z.ZodType>(schema: S, fn: () => Promise<unknown>): Promise<StudioResult<z.infer<S>>> {
  try {
    const parsed = schema.safeParse(await fn());
    if (!parsed.success) return { ok: false, error: `Unexpected Studio response: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, error: errorMessage(err), status: err instanceof KilnApiError ? err.status : undefined };
  }
}

const Id = z.string().regex(/^s[acvt]_[A-Za-z0-9_-]+$/);

const CreateInput = z.object({
  name: z.string().trim().min(1).max(80),
  source: AppSource.optional(),
  harness: z.string().optional(),
  model: z.string().optional(),
});
const PatchInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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
const ShipInput = z.object({ title: z.string().max(200).optional(), state: z.enum(["uat", "ready_for_review", "cancelled"]).optional() });
const AppDetailWire = z.object({ app: StudioApp, chats: z.array(Chat), versions: z.array(Version), pullRequest: AppPullRequest.optional() });

export async function studioApps() {
  return call(z.object({ apps: z.array(StudioApp) }), () => api.studioApps());
}
export async function studioCreateApp(input: z.input<typeof CreateInput>) {
  return call(StudioApp, () => api.studioCreateApp(CreateInput.parse(input)));
}
export async function studioApp(appId: string) {
  return call(AppDetailWire, () => api.studioApp(Id.parse(appId)));
}
export async function studioUpdateApp(appId: string, patch: z.input<typeof PatchInput>) {
  return call(StudioApp, () => api.studioUpdateApp(Id.parse(appId), PatchInput.parse(patch)));
}
/** The ship mode changes only here: the server checks the App policy's cap for the caller's role. */
export async function studioSetShipMode(appId: string, mode: z.input<typeof ShipMode>) {
  return call(StudioApp, () => api.studioSetShipMode(Id.parse(appId), ShipMode.parse(mode)));
}
export async function studioNewChat(appId: string, input: z.input<typeof ChatInput>) {
  return call(NewChatResult, () => api.studioNewChat(Id.parse(appId), ChatInput.parse(input)));
}
export async function studioChat(chatId: string) {
  return call(ChatDetail, () => api.studioChat(Id.parse(chatId)));
}
export async function studioSend(chatId: string, input: z.input<typeof SendInput>) {
  return call(SendResult, () => api.studioSend(Id.parse(chatId), SendInput.parse(input)));
}
export async function studioApply(chatId: string) {
  return call(ApplyResult, () => api.studioApply(Id.parse(chatId)));
}
export async function studioChatDiff(chatId: string) {
  return call(Diff, () => api.studioChatDiff(Id.parse(chatId)));
}
export async function studioChatPreview(chatId: string) {
  return call(Preview, () => api.studioChatPreview(Id.parse(chatId)));
}
export async function studioRestore(versionId: string) {
  return call(Version, () => api.studioRestore(Id.parse(versionId)));
}
export async function studioBookmark(versionId: string, on: boolean) {
  return call(Version, () => api.studioBookmark(Id.parse(versionId), z.boolean().parse(on)));
}
export async function studioVersionDiff(versionId: string) {
  return call(Diff, () => api.studioVersionDiff(Id.parse(versionId)));
}
export async function studioVersionPreview(versionId: string) {
  return call(Preview, () => api.studioVersionPreview(Id.parse(versionId)));
}
export async function studioStatus() {
  return call(StatusReport, () => api.studioStatus());
}
export async function studioRepositories() {
  return call(z.array(z.object({ owner: z.string(), name: z.string(), forge: z.string() })), async () => (await api.forgeRepositories()).repositories);
}

const ShipResult = z.union([z.object({ ok: z.literal(true), data: AppPullRequest }).passthrough(), z.object({ ok: z.literal(false), error: z.string() })]);

/** The `ship` tool: its data is the App's pull request. */
export async function studioShip(appId: string, input: z.input<typeof ShipInput>): Promise<StudioResult<AppPullRequest>> {
  const r = await call(ShipResult, () => api.studioTool("ship", { app: Id.parse(appId), ...ShipInput.parse(input) }));
  if (!r.ok) return r;
  return r.data.ok ? { ok: true, data: r.data.data } : { ok: false, error: r.data.error };
}

/** Stop: the chat's run is interrupted (docs/specs/studio.md, "Chats reuse runs"). */
export async function studioInterrupt(runId: string): Promise<StudioResult<null>> {
  return call(
    z.unknown().transform(() => null),
    () => api.interrupt(z.string().min(1).parse(runId)),
  );
}

/** The merge gate's reviews of the team's App pull requests (docs/specs/merge-gate.md). */
export async function studioMergeReviews(state?: string) {
  const q = state ? `?state=${encodeURIComponent(z.enum(["deciding", "merged", "needs_review", "closed"]).parse(state))}` : "";
  return call(z.object({ reviews: z.array(MergeReview) }), () => api.request("GET", `/api/v1/merge-gate/reviews${q}`));
}
