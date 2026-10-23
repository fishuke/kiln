import type { Scope } from "@kiln/auth";
import { DEFAULT_RUNNER_IMAGE, type Kiln } from "@kiln/engine";
import { HarnessType } from "@kiln/schema";
import {
  AppSource,
  ChatMode,
  runTool,
  Shipper,
  ShipMode,
  STUDIO_TOOLS,
  Studio,
  StudioError,
  studioRuns,
  targetOf,
  type StudioErrorCode,
  type StudioOptions,
  type TeamRole,
} from "@kiln/studio";
import { appDefinitionsFor } from "./studio-definitions";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { HttpError, type Env, type RouteContext } from "../app";
import type { Route } from "../openapi";
import { previewConfig, previewUrlFor, setPreviewResolver } from "./studio-preview";
import { otelStudioTracer, reportError } from "../trace-context";

// Ship mode is not set here: ship's setShipMode changes it after the App policy's cap check.
export const CreateApp = z
  .object({
    name: z.string().trim().min(1).max(100),
    projectId: z.string().min(1).optional(),
    source: AppSource.optional(),
    harness: HarnessType.optional(),
    model: z.string().trim().max(120).optional(),
  })
  .strict();
export const UpdateApp = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    projectId: z.string().min(1).nullable().optional(),
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
export const SetShipMode = z.object({ mode: ShipMode }).strict();
export const Ship = z
  .object({ title: z.string().trim().min(1).max(200).optional(), state: z.enum(["uat", "ready_for_review", "cancelled"]).optional() })
  .strict();

const S = "Studio";
export const routes: Route[] = [
  { method: "get", path: "/api/v1/studio/apps", summary: "Your team's Studio Apps", scope: "read", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/apps",
    summary: "Create an App from a template or a repository your team may use; it starts as creating",
    scope: "send",
    body: CreateApp,
    tag: S,
  },
  { method: "get", path: "/api/v1/studio/apps/{id}", summary: "An App with its chats and versions (newest first)", scope: "read", tag: S },
  {
    method: "patch",
    path: "/api/v1/studio/apps/{id}",
    summary: "Rename an App, change its Kiln Project or dev command",
    scope: "send",
    body: UpdateApp,
    tag: S,
  },
  {
    method: "put",
    path: "/api/v1/studio/apps/{id}/ship-mode",
    summary: "Change an App's ship mode, up to the highest mode the App's policy allows your team role",
    scope: "send",
    body: SetShipMode,
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/apps/{id}/ship",
    summary: "Open or update the App's pull request; as its author, mark it ready for review; or cancel it",
    scope: "send",
    body: Ship,
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/apps/{id}/pause",
    summary: "Snapshot an App's workspace and free its sandbox; the next use resumes it",
    scope: "send",
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/apps/{id}/retry",
    summary: "Set a failed App up again on a fresh sandbox; it is creating until setup succeeds or fails",
    scope: "send",
    tag: S,
  },
  {
    method: "delete",
    path: "/api/v1/studio/apps/{id}",
    summary: "Delete a failed App: its sandbox, chats, turns and versions",
    scope: "send",
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/apps/{id}/chats",
    summary: "Start a chat (its own worktree and preview), optionally with a first message",
    scope: "send",
    body: NewChat,
    tag: S,
  },
  { method: "get", path: "/api/v1/studio/chats/{id}", summary: "A chat with its turns (oldest first)", scope: "read", tag: S },
  {
    method: "delete",
    path: "/api/v1/studio/chats/{id}",
    summary: "Delete a chat that isn't working: its worktree, branch, preview and turns",
    scope: "send",
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/chats/{id}/messages",
    summary: "Send a message: starts a turn, or steers the running one",
    scope: "send",
    body: SendMessage,
    tag: S,
  },
  { method: "post", path: "/api/v1/studio/chats/{id}/apply", summary: "Apply a chat's checkpoints to the App's main line as a version", scope: "send", tag: S },
  { method: "get", path: "/api/v1/studio/chats/{id}/diff", summary: "The chat's changes since it branched or was last applied", scope: "read", tag: S },
  { method: "get", path: "/api/v1/studio/chats/{id}/preview", summary: "The chat's live preview (starts its dev server)", scope: "read", tag: S },
  {
    method: "get",
    path: "/api/v1/studio/chats/{id}/events",
    summary: "Server-sent events from the chat's Studio events: the chat and the turn each event names",
    scope: "read",
    tag: S,
  },
  { method: "post", path: "/api/v1/studio/versions/{id}/restore", summary: "Restore a version as a new version", scope: "send", tag: S },
  { method: "post", path: "/api/v1/studio/versions/{id}/bookmark", summary: "Pin or unpin a version", scope: "send", body: Bookmark, tag: S },
  { method: "get", path: "/api/v1/studio/versions/{id}/diff", summary: "A version's changes against its parent", scope: "read", tag: S },
  { method: "get", path: "/api/v1/studio/versions/{id}/preview", summary: "Preview an earlier version", scope: "read", tag: S },
  { method: "get", path: "/api/v1/studio/status", summary: "What is working and what needs you, across your team's Apps", scope: "read", tag: S },
  {
    method: "get",
    path: "/api/v1/studio/events",
    summary: "Server-sent events for your team's Apps: Studio events and merge gate reviews",
    scope: "read",
    tag: S,
  },
  {
    method: "post",
    path: "/api/v1/studio/tools/{name}",
    summary:
      "Run a Studio tool by name (status, open_app, new_chat, send, apply, restore, bookmark, look, ship, set_ship_mode, focus, show); status, look, focus and show need read, the rest send",
    scope: "send",
    tag: S,
  },
];

/** Tools that only read (or only move the caller's screen). */
const READ_TOOLS = new Set(["status", "look", "focus", "show"]);

/** Studio runs only when the server opts in (docs/specs/studio.md, "Enabling Studio and restarts"). */
export function studioEnabled(): boolean {
  return process.env.KILN_STUDIO === "1";
}

const services = new WeakMap<Kiln, Studio | null>();
const overrides = new WeakMap<Kiln, Partial<StudioOptions>>();

/** Override Studio's options for a `Kiln` before its first use (tests). Studio still needs KILN_STUDIO=1. */
export function configureStudio(kiln: Kiln, options: Partial<StudioOptions>) {
  overrides.set(kiln, options);
  services.delete(kiln);
  shippers.delete(kiln);
}

/** The Studio service for a `Kiln`, built on first use; undefined unless KILN_STUDIO=1 and a sandbox backend exists. */
export function studioFor(kiln: Kiln): Studio | undefined {
  if (services.has(kiln)) return services.get(kiln) ?? undefined;
  const sandboxes = kiln.sandboxes[kiln.options.defaultBackend ?? "local"] ?? kiln.sandboxes.local;
  const over = overrides.get(kiln) ?? {};
  if (!studioEnabled() || (!sandboxes && !over.sandboxes)) {
    services.set(kiln, null);
    return undefined;
  }
  const studio = new Studio({
    store: kiln.store,
    objects: kiln.objects,
    bus: kiln.bus,
    clock: kiln.clock,
    sandboxes: sandboxes!,
    // Turns are runs of the App's agents (ADR-012): the engine resolves them through KilnOptions.apps (studioEngineHooks).
    definitions: appDefinitionsFor(kiln),
    runs: studioRuns(kiln.runs),
    // Command approvals App runs wait on: the chat asks the person; they decide through the gate decision API.
    gates: kiln.gates,
    // Only values people assigned to the App (team → Kiln Project → App); never the secret vault.
    env: (app) => {
      const v = kiln.variables.forApp(app);
      return { env: v.env, secretValues: v.secretValues };
    },
    clone: async (source) => {
      const [owner, name] = source.repo.split("/") as [string, string];
      const repo = { owner, name };
      return { url: kiln.forge.cloneUrl(repo, await kiln.forge.sandboxToken?.(repo)) };
    },
    // The Studio image (the runner image plus the warm Next.js template), else the server's runner image (KILN_RUNNER_IMAGE).
    image: process.env.KILN_STUDIO_IMAGE || kiln.options.defaultImage || DEFAULT_RUNNER_IMAGE,
    previewUrl: previewUrlFor(),
    tracer: otelStudioTracer(),
    ...(previewConfig() ? { previewDomain: process.env.KILN_STUDIO_PREVIEW_DOMAIN!.trim() } : {}),
    ...(process.env.KILN_STUDIO_TEMPLATES?.trim() ? { templatesDir: process.env.KILN_STUDIO_TEMPLATES.trim() } : {}),
    ...over,
  });
  services.set(kiln, studio);
  setPreviewResolver(kiln, studio);
  return studio;
}

const shippers = new WeakMap<Kiln, Shipper>();

/** Whether any factory lists the repository ("owner/name"): Studio never pushes its main branch (ADR-012). */
function factoryRepository(kiln: Kiln, repo: string): boolean {
  return kiln.defs
    .list()
    .some((f) => f.appliedSha !== undefined && kiln.defs.resolved(f.appliedSha).factory.repositories.some((r) => `${r.owner}/${r.name}` === repo));
}

/**
 * Shipping for a `Kiln` (docs/specs/studio.md, "Shipping"): pushes per ship mode, the App's pull
 * request and the merge gate. Caps and default-branch pushes come only from the App's policy.
 * Template Apps get a repository under KILN_STUDIO_REPO_OWNER on their first push.
 */
export function shipperFor(kiln: Kiln): Shipper | undefined {
  const existing = shippers.get(kiln);
  if (existing) return existing;
  const studio = studioFor(kiln);
  if (!studio) return undefined;
  const definitions = appDefinitionsFor(kiln);
  const owner = process.env.KILN_STUDIO_REPO_OWNER?.trim();
  const shipper = new Shipper({
    studio,
    store: kiln.store,
    bus: kiln.bus,
    clock: kiln.clock,
    forge: () => kiln.forge,
    ...(owner ? { newRepo: () => ({ owner }) } : {}),
    linkedToFactory: (repo) => factoryRepository(kiln, repo),
    policyOf: (app) => definitions.policy(targetOf(app)),
    mergeGate: kiln.mergeGate,
    ...(kiln.preview ? { previews: kiln.preview } : {}),
    audit: (actor, action, target, details) => kiln.audit(actor, action, target, details),
  });
  shipper.start();
  // The gate's later outcome (a person merged, or the review closed) lands on the App's pull request.
  kiln.bus.subscribe("merge_gate.review_updated", (e) => {
    if (!e.payload.appId) return;
    shipper.reviewUpdated({
      ...(e.payload.pullRequestId ? { pullRequestId: e.payload.pullRequestId } : {}),
      repo: e.payload.repo,
      number: e.payload.number,
      state: e.payload.state,
    });
  });
  shippers.set(kiln, shipper);
  return shipper;
}

const STATUS: Record<StudioErrorCode, 400 | 404 | 409 | 503> = { not_found: 404, invalid: 400, busy: 409, conflict: 409, unavailable: 503 };

/** Studio's REST routes (docs/specs/studio.md). Every route acts as a signed-in user in their current team, with a team-wide scope. */
export function register(ctx: RouteContext) {
  const { app, kiln } = ctx;
  // Built now, so the preview proxy can resolve targets after a restart before any Studio route is called.
  studioFor(kiln);
  // And shipping, so pushes follow new versions from the start.
  shipperFor(kiln);
  const studio = () => {
    const s = studioFor(kiln);
    if (!s)
      throw new StudioError(
        "unavailable",
        studioEnabled() ? "Studio needs a sandbox backend (KILN_SANDBOX)" : "Studio is not enabled on this server (KILN_STUDIO=1)",
      );
    return s;
  };
  const caller = (c: Context<Env>, scope: Scope) => {
    ctx.need(c, scope, "*");
    const access = ctx.access(c);
    const role: TeamRole | undefined = access.superuser ? "owner" : access.teamRole;
    return { team: ctx.team(c).id, by: ctx.user(c).email, via: "api" as const, ...(role ? { role } : {}) };
  };
  const shipper = () => {
    const s = shipperFor(kiln);
    if (!s) throw new StudioError("unavailable", "shipping isn't configured on this server");
    return s;
  };
  /** Imports only from repositories the caller's team may use, through the server's forge. */
  const checkImport = (c: Context<Env>, source: AppSource | undefined) => {
    if (source?.kind !== "repo") return;
    if (source.connection && source.connection !== kiln.forge.name)
      throw new HttpError(400, `this server imports through its ${kiln.forge.name} connection, not ${source.connection}`);
    ctx.checkOrgs(c, [{ owner: source.repo.split("/")[0]!, ...(source.connection ? { forge: source.connection } : {}) }]);
  };
  const ownApp = (c: Context<Env>, id: string, scope: Scope) => {
    const who = caller(c, scope);
    const found = studio().getApp(id);
    if (!found || found.app.team !== who.team) throw new HttpError(404, `unknown app ${id}`);
    return { ...found, who };
  };
  const ownChat = (c: Context<Env>, id: string, scope: Scope) => {
    const found = studio().getChat(id);
    if (!found) throw new HttpError(404, `unknown chat ${id}`);
    return { ...found, who: ownApp(c, found.chat.appId, scope).who };
  };
  const ownVersion = (c: Context<Env>, id: string, scope: Scope) => {
    const v = studio().getVersion(id);
    if (!v) throw new HttpError(404, `unknown version ${id}`);
    return { version: v, who: ownApp(c, v.appId, scope).who };
  };
  type Handler = (c: Context<Env>) => Promise<Response> | Response;
  const wrap =
    (fn: Handler): Handler =>
    async (c) => {
      try {
        return await fn(c);
      } catch (err) {
        if (!(err instanceof StudioError)) throw err;
        const status = STATUS[err.code];
        // On the request's span, and a 5xx logged at ERROR in its trace; traceErrorResponses adds the trace id.
        reportError(err, status, { "kiln.studio.error.code": err.code, "http.route": c.req.routePath });
        return c.json({ error: err.message, code: err.code }, status);
      }
    };
  const id = (c: Context<Env>) => c.req.param("id")!;

  app.get(
    "/api/v1/studio/apps",
    wrap((c) => c.json({ apps: studio().listApps(caller(c, "read").team) })),
  );
  app.post(
    "/api/v1/studio/apps",
    wrap(async (c) => {
      const who = caller(c, "send");
      const body = CreateApp.parse(await c.req.json());
      checkImport(c, body.source);
      return c.json(await studio().createApp({ ...body, team: who.team, by: who.by }), 201);
    }),
  );
  app.get(
    "/api/v1/studio/apps/:id",
    wrap((c) => {
      const { who: _, ...found } = ownApp(c, id(c), "read");
      const pullRequest = shipperFor(kiln)?.pullRequests(id(c))[0];
      return c.json({ ...found, ...(pullRequest ? { pullRequest } : {}) });
    }),
  );
  app.put(
    "/api/v1/studio/apps/:id/ship-mode",
    wrap(async (c) => {
      const { who } = ownApp(c, id(c), "send");
      const { mode } = SetShipMode.parse(await c.req.json());
      return c.json(shipper().setShipMode(id(c), mode, { by: who.by, ...(who.role ? { role: who.role } : {}) }));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/ship",
    wrap(async (c) => {
      const { who } = ownApp(c, id(c), "send");
      const body = Ship.parse(await c.req.json());
      return c.json(await shipper().ship(id(c), body, { by: who.by, ...(who.role ? { role: who.role } : {}) }));
    }),
  );
  app.patch(
    "/api/v1/studio/apps/:id",
    wrap(async (c) => {
      ownApp(c, id(c), "send");
      return c.json(studio().updateApp(id(c), UpdateApp.parse(await c.req.json())));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/pause",
    wrap(async (c) => {
      ownApp(c, id(c), "send");
      return c.json(await studio().pause(id(c)));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/retry",
    wrap(async (c) => {
      ownApp(c, id(c), "send");
      return c.json(await studio().retryApp(id(c)));
    }),
  );
  app.delete(
    "/api/v1/studio/apps/:id",
    wrap(async (c) => {
      ownApp(c, id(c), "send");
      await studio().deleteApp(id(c));
      return c.body(null, 204);
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/chats",
    wrap(async (c) => {
      const { who } = ownApp(c, id(c), "send");
      const body = NewChat.parse(await c.req.json());
      return c.json(await studio().newChat(id(c), { ...body, by: who.by, via: "web" }), 201);
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id",
    wrap((c) => {
      const { who: _, ...found } = ownChat(c, id(c), "read");
      return c.json(found);
    }),
  );
  app.delete(
    "/api/v1/studio/chats/:id",
    wrap(async (c) => {
      ownChat(c, id(c), "send");
      await studio().deleteChat(id(c));
      return c.body(null, 204);
    }),
  );
  app.post(
    "/api/v1/studio/chats/:id/messages",
    wrap(async (c) => {
      const { who } = ownChat(c, id(c), "send");
      const body = SendMessage.parse(await c.req.json());
      return c.json(await studio().send(id(c), { ...body, by: who.by, via: "web" }));
    }),
  );
  app.post(
    "/api/v1/studio/chats/:id/apply",
    wrap(async (c) => {
      const { who } = ownChat(c, id(c), "send");
      return c.json(await studio().apply(id(c), who.by));
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/diff",
    wrap(async (c) => {
      ownChat(c, id(c), "read");
      return c.json({ diff: await studio().diff({ chatId: id(c) }) });
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/preview",
    wrap(async (c) => {
      ownChat(c, id(c), "read");
      return c.json(await studio().preview({ chatId: id(c) }));
    }),
  );
  app.get(
    "/api/v1/studio/chats/:id/events",
    wrap((c) => {
      ownChat(c, id(c), "read");
      const chatId = id(c);
      const s = studio();
      return streamSSE(c, async (stream) => {
        /** The chat, and the turn an event names (else its latest). */
        const send = async (turnId?: string) => {
          const found = s.getChat(chatId);
          if (!found || stream.aborted) return;
          await stream.writeSSE({ event: "chat", data: JSON.stringify(found.chat) });
          const turn = turnId ? found.turns.find((t) => t.id === turnId) : found.turns.at(-1);
          if (turn) await stream.writeSSE({ event: "turn", data: JSON.stringify(turn) });
        };
        let queue = send();
        const off = kiln.bus.subscribe("*", (e) => {
          const p = e.payload as { chatId?: string; turnId?: string };
          if (e.type.startsWith("studio.") && p.chatId === chatId) queue = queue.then(() => send(p.turnId));
        });
        await new Promise<void>((resolve) => stream.onAbort(resolve));
        off();
        await queue;
      });
    }),
  );
  app.get(
    "/api/v1/studio/events",
    wrap((c) => {
      const team = caller(c, "read").team;
      const s = studio();
      return streamSSE(c, async (stream) => {
        let queue = Promise.resolve();
        const off = kiln.bus.subscribe("*", (e) => {
          if (!e.type.startsWith("studio.") && !e.type.startsWith("merge_gate.")) return;
          const appId = (e.payload as { appId?: unknown }).appId;
          if (typeof appId !== "string" || s.getApp(appId)?.app.team !== team) return;
          queue = queue.then(() => (stream.aborted ? undefined : stream.writeSSE({ event: e.type, data: JSON.stringify(e) })));
        });
        await new Promise<void>((resolve) => stream.onAbort(resolve));
        off();
        await queue;
      });
    }),
  );
  app.post(
    "/api/v1/studio/versions/:id/restore",
    wrap(async (c) => {
      const { who } = ownVersion(c, id(c), "send");
      return c.json(await studio().restore(id(c), who.by));
    }),
  );
  app.post(
    "/api/v1/studio/versions/:id/bookmark",
    wrap(async (c) => {
      ownVersion(c, id(c), "send");
      const { on } = Bookmark.parse(await c.req.json());
      return c.json(studio().bookmark(id(c), on));
    }),
  );
  app.get(
    "/api/v1/studio/versions/:id/diff",
    wrap(async (c) => {
      ownVersion(c, id(c), "read");
      return c.json({ diff: await studio().diff({ versionId: id(c) }) });
    }),
  );
  app.get(
    "/api/v1/studio/versions/:id/preview",
    wrap(async (c) => {
      ownVersion(c, id(c), "read");
      return c.json(await studio().preview({ versionId: id(c) }));
    }),
  );
  app.get(
    "/api/v1/studio/status",
    wrap((c) => c.json(studio().status({ team: caller(c, "read").team }))),
  );
  app.post(
    "/api/v1/studio/tools/:name",
    wrap(async (c) => {
      const name = c.req.param("name")!;
      if (!STUDIO_TOOLS.some((t) => t.name === name)) throw new HttpError(404, `unknown tool ${name}`);
      const who = caller(c, READ_TOOLS.has(name) ? "read" : "send");
      const input: unknown = await c.req.json();
      if (name === "open_app") {
        const source = AppSource.safeParse((input as { source?: unknown } | null)?.source);
        if (source.success) checkImport(c, source.data);
      }
      return c.json(await runTool(studio(), name, input, who, shipperFor(kiln)));
    }),
  );
}
