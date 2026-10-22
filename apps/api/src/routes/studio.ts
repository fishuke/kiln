import { DEFAULT_RUNNER_IMAGE, type Kiln } from "@kiln/engine";
import { adapterFor } from "@kiln/harness";
import { HarnessType } from "@kiln/schema";
import { AppSource, ChatMode, runTool, ShipMode, STUDIO_TOOLS, Studio, StudioError, type App, type StudioErrorCode, type StudioOptions } from "@kiln/studio";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { HttpError, type Env, type RouteContext } from "../app";
import type { Route } from "../openapi";
import { previewConfig, previewUrlFor, setPreviewResolver } from "./studio-preview";

export const CreateApp = z
  .object({
    name: z.string().trim().min(1).max(100),
    projectId: z.string().min(1).optional(),
    source: AppSource.optional(),
    shipMode: ShipMode.optional(),
    harness: HarnessType.optional(),
    model: z.string().trim().max(120).optional(),
  })
  .strict();
export const UpdateApp = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    projectId: z.string().min(1).nullable().optional(),
    shipMode: ShipMode.optional(),
    devCommand: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();
export const NewChat = z
  .object({
    prompt: z.string().min(1).optional(),
    mode: ChatMode.optional(),
    harness: HarnessType.optional(),
    model: z.string().trim().max(120).optional(),
    title: z.string().trim().max(100).optional(),
  })
  .strict();
export const SendMessage = z.object({ text: z.string().min(1), mode: ChatMode.optional() }).strict();
export const Bookmark = z.object({ on: z.boolean() }).strict();

const S = "Studio";
export const routes: Route[] = [
  { method: "get", path: "/api/v1/studio/apps", summary: "Your team's Studio Apps", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/apps",
    summary: "Create an App from a template or an existing repository; it starts as creating",
    body: CreateApp,
    tag: S,
  },
  { method: "get", path: "/api/v1/studio/apps/{id}", summary: "An App with its chats and versions (newest first)", tag: S },
  { method: "patch", path: "/api/v1/studio/apps/{id}", summary: "Rename an App, change its ship mode, Kiln Project or dev command", body: UpdateApp, tag: S },
  { method: "post", path: "/api/v1/studio/apps/{id}/pause", summary: "Snapshot an App's workspace and free its sandbox; the next use resumes it", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/apps/{id}/chats",
    summary: "Start a chat (its own worktree and preview), optionally with a first message",
    body: NewChat,
    tag: S,
  },
  { method: "get", path: "/api/v1/studio/chats/{id}", summary: "A chat with its turns (oldest first)", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/chats/{id}/messages",
    summary: "Send a message: starts a turn, or steers the running one",
    body: SendMessage,
    tag: S,
  },
  { method: "post", path: "/api/v1/studio/chats/{id}/apply", summary: "Apply a chat's checkpoints to the App's main line as a version", tag: S },
  { method: "get", path: "/api/v1/studio/chats/{id}/diff", summary: "The chat's changes since it branched or was last applied", tag: S },
  { method: "get", path: "/api/v1/studio/chats/{id}/preview", summary: "The chat's live preview (starts its dev server)", tag: S },
  { method: "get", path: "/api/v1/studio/chats/{id}/events", summary: "Server-sent events: the chat and its latest turn whenever they change", tag: S },
  { method: "post", path: "/api/v1/studio/versions/{id}/restore", summary: "Restore a version as a new version", tag: S },
  { method: "post", path: "/api/v1/studio/versions/{id}/bookmark", summary: "Pin or unpin a version", body: Bookmark, tag: S },
  { method: "get", path: "/api/v1/studio/versions/{id}/diff", summary: "A version's changes against its parent", tag: S },
  { method: "get", path: "/api/v1/studio/versions/{id}/preview", summary: "Preview an earlier version", tag: S },
  { method: "get", path: "/api/v1/studio/status", summary: "What is working and what needs you, across your team's Apps", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/tools/{name}",
    summary: "Run a Studio tool by name (status, open_app, new_chat, send, apply, restore, bookmark, look, focus, show)",
    tag: S,
  },
];

const services = new WeakMap<Kiln, Studio | null>();
const overrides = new WeakMap<Kiln, Partial<StudioOptions>>();

/** Override Studio's options for a `Kiln` before its first use (tests, embedders). */
export function configureStudio(kiln: Kiln, options: Partial<StudioOptions>) {
  overrides.set(kiln, options);
  services.delete(kiln);
}

/**
 * The Studio service for a `Kiln`, built on first use from its store, bus, clock, sandboxes and harness.
 * Undefined when the server has no sandbox backend.
 */
export function studioFor(kiln: Kiln): Studio | undefined {
  if (services.has(kiln)) return services.get(kiln) ?? undefined;
  const backend = kiln.options.defaultBackend ?? "local";
  const sandboxes = kiln.sandboxes[backend] ?? kiln.sandboxes.local;
  const over = overrides.get(kiln) ?? {};
  if (!sandboxes && !over.sandboxes) {
    services.set(kiln, null);
    return undefined;
  }
  const studio = new Studio({
    store: kiln.store,
    objects: kiln.objects,
    bus: kiln.bus,
    clock: kiln.clock,
    sandboxes: sandboxes!,
    harness: (type) => kiln.options.harness?.(type, "studio") ?? adapterFor(type),
    credentials: (app, type) => kiln.runs.credentials(type, { secrets: [], harness: { type } }, { teamId: app.team }),
    env: (app) => studioEnv(kiln, app),
    clone: async (source) => {
      const [owner, name] = source.repo.split("/") as [string, string];
      const repo = { owner, name };
      return { url: kiln.forge.cloneUrl(repo, await kiln.forge.sandboxToken?.(repo)) };
    },
    // The Studio image (the runner image plus the warm Next.js template), else the server's runner image (KILN_RUNNER_IMAGE).
    image: process.env.KILN_STUDIO_IMAGE || kiln.options.defaultImage || DEFAULT_RUNNER_IMAGE,
    previewUrl: previewUrlFor(),
    ...(previewConfig() ? { previewDomain: process.env.KILN_STUDIO_PREVIEW_DOMAIN!.trim() } : {}),
    ...over,
  });
  services.set(kiln, studio);
  setPreviewResolver(kiln, studio);
  return studio;
}

/** The keys an App's example env file asks for, from the team's secrets (never written to the repository). */
function studioEnv(kiln: Kiln, app: App): Record<string, string> {
  const resolver = kiln.vault.resolver({ teamId: app.team });
  const env: Record<string, string> = {};
  for (const key of app.setup?.envRequired ?? []) Object.assign(env, resolver.provide(key) ?? {});
  return env;
}

const STATUS: Record<StudioErrorCode, 400 | 404 | 409 | 503> = { not_found: 404, invalid: 400, busy: 409, conflict: 409, unavailable: 503 };

/** Studio's REST routes (docs/specs/studio.md). Every route acts as a signed-in user in their current team. */
export function register(ctx: RouteContext) {
  const { app, kiln } = ctx;
  // Built now, so the preview proxy can resolve targets after a restart before any Studio route is called.
  studioFor(kiln);
  const studio = () => {
    const s = studioFor(kiln);
    if (!s) throw new StudioError("unavailable", "Studio needs a sandbox backend (KILN_SANDBOX)");
    return s;
  };
  const caller = (c: Context<Env>) => ({ team: ctx.team(c).id, by: ctx.user(c).email, via: "api" as const });
  const ownApp = (c: Context<Env>, id: string) => {
    const found = studio().getApp(id);
    if (!found || found.app.team !== ctx.team(c).id) throw new HttpError(404, `unknown app ${id}`);
    return found;
  };
  const ownChat = (c: Context<Env>, id: string) => {
    const found = studio().getChat(id);
    if (!found) throw new HttpError(404, `unknown chat ${id}`);
    ownApp(c, found.chat.appId);
    return found;
  };
  const ownVersion = (c: Context<Env>, id: string) => {
    const v = studio().getVersion(id);
    if (!v) throw new HttpError(404, `unknown version ${id}`);
    ownApp(c, v.appId);
    return v;
  };
  type Handler = (c: Context<Env>) => Promise<Response> | Response;
  const wrap =
    (fn: Handler): Handler =>
    async (c) => {
      try {
        return await fn(c);
      } catch (err) {
        if (err instanceof StudioError) return c.json({ error: err.message, code: err.code }, STATUS[err.code]);
        throw err;
      }
    };
  const id = (c: Context<Env>) => c.req.param("id")!;

  app.get(
    "/api/v1/studio/apps",
    wrap((c) => c.json({ apps: studio().listApps(ctx.team(c).id) })),
  );
  app.post(
    "/api/v1/studio/apps",
    wrap(async (c) => {
      const body = CreateApp.parse(await c.req.json());
      const who = caller(c);
      return c.json(await studio().createApp({ ...body, team: who.team, by: who.by }), 201);
    }),
  );
  app.get(
    "/api/v1/studio/apps/:id",
    wrap((c) => c.json(ownApp(c, id(c)))),
  );
  app.patch(
    "/api/v1/studio/apps/:id",
    wrap(async (c) => {
      ownApp(c, id(c));
      return c.json(studio().updateApp(id(c), UpdateApp.parse(await c.req.json())));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/pause",
    wrap(async (c) => {
      ownApp(c, id(c));
      return c.json(await studio().pause(id(c)));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/chats",
    wrap(async (c) => {
      ownApp(c, id(c));
      const body = NewChat.parse(await c.req.json());
      const who = caller(c);
      return c.json(await studio().newChat(id(c), { ...body, by: who.by, via: "web" }), 201);
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id",
    wrap((c) => c.json(ownChat(c, id(c)))),
  );
  app.post(
    "/api/v1/studio/chats/:id/messages",
    wrap(async (c) => {
      ownChat(c, id(c));
      const body = SendMessage.parse(await c.req.json());
      return c.json(await studio().send(id(c), { ...body, by: caller(c).by, via: "web" }));
    }),
  );
  app.post(
    "/api/v1/studio/chats/:id/apply",
    wrap(async (c) => {
      ownChat(c, id(c));
      return c.json(await studio().apply(id(c), caller(c).by));
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/diff",
    wrap(async (c) => {
      ownChat(c, id(c));
      return c.json({ diff: await studio().diff({ chatId: id(c) }) });
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/preview",
    wrap(async (c) => {
      ownChat(c, id(c));
      return c.json(await studio().preview({ chatId: id(c) }));
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/events",
    wrap((c) => {
      ownChat(c, id(c));
      const chatId = id(c);
      return streamSSE(c, async (stream) => {
        let last = "";
        while (!stream.aborted) {
          const found = studio().getChat(chatId);
          if (!found) break;
          const turn = found.turns.at(-1);
          const now = JSON.stringify([found.chat, turn]);
          if (now !== last) {
            last = now;
            await stream.writeSSE({ event: "chat", data: JSON.stringify(found.chat) });
            if (turn) await stream.writeSSE({ event: "turn", data: JSON.stringify(turn) });
          }
          await stream.sleep(1000);
        }
      });
    }),
  );
  app.post(
    "/api/v1/studio/versions/:id/restore",
    wrap(async (c) => {
      ownVersion(c, id(c));
      return c.json(await studio().restore(id(c), caller(c).by));
    }),
  );
  app.post(
    "/api/v1/studio/versions/:id/bookmark",
    wrap(async (c) => {
      ownVersion(c, id(c));
      const { on } = Bookmark.parse(await c.req.json());
      return c.json(studio().bookmark(id(c), on));
    }),
  );
  app.get(
    "/api/v1/studio/versions/:id/diff",
    wrap(async (c) => {
      ownVersion(c, id(c));
      return c.json({ diff: await studio().diff({ versionId: id(c) }) });
    }),
  );
  app.get(
    "/api/v1/studio/versions/:id/preview",
    wrap(async (c) => {
      ownVersion(c, id(c));
      return c.json(await studio().preview({ versionId: id(c) }));
    }),
  );
  app.get(
    "/api/v1/studio/status",
    wrap((c) => c.json(studio().status({ team: ctx.team(c).id }))),
  );
  app.post(
    "/api/v1/studio/tools/:name",
    wrap(async (c) => {
      const name = c.req.param("name")!;
      if (!STUDIO_TOOLS.some((t) => t.name === name)) throw new HttpError(404, `unknown tool ${name}`);
      const input: unknown = await c.req.json();
      return c.json(await runTool(studio(), name, input, caller(c)));
    }),
  );
}
