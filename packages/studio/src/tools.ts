import { HarnessType } from "@kiln/schema";
import { z } from "zod";
import type { Studio } from "./studio";
import { ChatMode, AppSource, ShipMode, StudioError, type Via } from "./types";

export type ToolKind = "server" | "client";
export type StudioTool<I extends z.ZodType = z.ZodType, N extends string = string> = { name: N; kind: ToolKind; description: string; input: I };
export type ClientAction = { focus: { app: string; chat?: string } } | { show: "preview" | "code" | "history" };
export type ToolResult = { ok: true; data: unknown; client?: ClientAction } | { ok: false; error: string };
export type ToolCaller = { team: string; by: string; via: Via };

const tool = <N extends string, I extends z.ZodType>(name: N, kind: ToolKind, description: string, input: I): StudioTool<I, N> => ({ name, kind, description, input });

const Status = z.object({ app: z.string().optional() }).strict();
const OpenApp = z.union([
  z.object({ app: z.string() }).strict(),
  z.object({ name: z.string().min(1).max(100), source: AppSource.optional(), shipMode: ShipMode.optional(), projectId: z.string().optional() }).strict(),
]);
const NewChat = z
  .object({
    app: z.string(),
    prompt: z.string().min(1).optional(),
    mode: ChatMode.optional(),
    harness: HarnessType.optional(),
    model: z.string().optional(),
    title: z.string().max(100).optional(),
  })
  .strict();
const Send = z.object({ chat: z.string(), text: z.string().min(1), mode: ChatMode.optional() }).strict();
const ChatRef = z.object({ chat: z.string() }).strict();
const VersionRef = z.object({ version: z.string() }).strict();
const Bookmark = z.object({ version: z.string(), on: z.boolean() }).strict();
const Focus = z.object({ app: z.string(), chat: z.string().optional() }).strict();
const Show = z.object({ view: z.enum(["preview", "code", "history"]) }).strict();

/** Every Studio action, for any client: the web page, MCP and voice (ADR-012). */
export const STUDIO_TOOLS = [
  tool("status", "server", "What is running and what needs the person, for one app or all of them.", Status),
  tool("open_app", "server", "Open an app by id, or create one from a name and a source (a template or a repository).", OpenApp),
  tool("new_chat", "server", "Start a new chat (a parallel line of work) in an app, optionally with a first message.", NewChat),
  tool("send", "server", "Send a message to a chat: starts a turn, or steers the one that is running. Pass the person's words as they said them.", Send),
  tool("apply", "server", "Apply a chat's changes to the app's main line as a new version.", ChatRef),
  tool("restore", "server", "Restore an earlier version as a new version; nothing is lost.", VersionRef),
  tool("bookmark", "server", "Pin or unpin a version.", Bookmark),
  tool("look", "server", "The live preview of a chat (its URL).", ChatRef),
  tool("focus", "client", "Move the person's screen to an app and, optionally, a chat.", Focus),
  tool("show", "client", "Show the preview, the code or the history in the person's screen.", Show),
] as const satisfies readonly StudioTool[];

export type StudioToolName = (typeof STUDIO_TOOLS)[number]["name"];

/** Run a tool by name with unvalidated input, as the caller's team. Errors come back as `{ ok: false }`. */
export async function runTool(studio: Studio, name: string, input: unknown, caller: ToolCaller): Promise<ToolResult> {
  const def = STUDIO_TOOLS.find((t) => t.name === name);
  if (!def) return { ok: false, error: `unknown tool ${name}` };
  const parsed = def.input.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  try {
    return await dispatch(studio, name as StudioToolName, parsed.data, caller);
  } catch (err) {
    if (err instanceof StudioError) return { ok: false, error: err.message };
    throw err;
  }
}

async function dispatch(studio: Studio, name: StudioToolName, a: any, caller: ToolCaller): Promise<ToolResult> {
  const app = (id: string) => {
    const p = studio.getApp(id);
    if (!p || p.app.team !== caller.team) throw new StudioError("not_found", `unknown app ${id}`);
    return p;
  };
  const chat = (id: string) => {
    const c = studio.getChat(id);
    if (!c) throw new StudioError("not_found", `unknown chat ${id}`);
    app(c.chat.appId);
    return c;
  };
  const version = (id: string) => {
    const p = studio.listApps(caller.team).find((x) => studio.getApp(x.id)!.versions.some((v) => v.id === id));
    if (!p) throw new StudioError("not_found", `unknown version ${id}`);
    return id;
  };
  switch (name) {
    case "status":
      if (a.app) app(a.app);
      return { ok: true, data: studio.status({ team: caller.team, ...(a.app ? { app: a.app } : {}) }) };
    case "open_app": {
      const p = "app" in a ? app(a.app).app : await studio.createApp({ team: caller.team, by: caller.by, ...a });
      return { ok: true, data: p, client: { focus: { app: p.id } } };
    }
    case "new_chat": {
      const { app: appId, ...rest } = a;
      app(appId);
      const r = await studio.newChat(appId, { by: caller.by, via: caller.via, ...rest });
      return { ok: true, data: r, client: { focus: { app: appId, chat: r.chat.id } } };
    }
    case "send":
      chat(a.chat);
      return { ok: true, data: await studio.send(a.chat, { by: caller.by, via: caller.via, text: a.text, ...(a.mode ? { mode: a.mode } : {}) }) };
    case "apply":
      chat(a.chat);
      return { ok: true, data: await studio.apply(a.chat, caller.by) };
    case "restore":
      return { ok: true, data: await studio.restore(version(a.version), caller.by) };
    case "bookmark":
      return { ok: true, data: studio.bookmark(version(a.version), a.on) };
    case "look":
      chat(a.chat);
      return { ok: true, data: await studio.preview({ chatId: a.chat }) };
    case "focus":
      return { ok: true, data: null, client: { focus: a.chat ? { app: a.app, chat: a.chat } : { app: a.app } } };
    case "show":
      return { ok: true, data: null, client: { show: a.view } };
    default:
      return name satisfies never;
  }
}
