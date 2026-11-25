/**
 * The Context's routes (ADR-019, docs/specs/studio-context.md section 7), registered with Studio's.
 * The document syncs over an event stream and a POST, both behind the same checks as every other
 * Studio route; the agent's tools come in with a person's token or a run's.
 */
import type { Scope } from "@kiln/auth";
import type { Kiln } from "@kiln/engine";
import { COLLECTIONS, CONTEXT_TOOL_NAMES, ContextService, FunctionalRole, QuestionAnswer, StudioError, type ContextEvent, type ContextExport, type ContextPerson, type Studio, type Turn } from "@kiln/studio";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { HttpError, type Env, type RouteContext } from "../app";
import type { Route } from "../openapi";

const S = "Studio";
const base = "/api/v1/studio/apps/{id}/context";

const Bytes = z.string().max(8_000_000).describe("base64");
export const ContextSync = z.object({ update: Bytes.optional(), awareness: Bytes.optional(), client: z.string().max(64).optional() });
export const ContextPrompt = z.object({ text: z.string().min(1).max(20_000) });
export const ContextAnswer = z.object({ answer: QuestionAnswer });
export const ContextPropose = z.object({ kind: z.enum(["edit", "add", "remove", "answer"]), summary: z.string().min(1).max(400), patch: z.unknown(), fragmentId: z.string().optional() });
export const ContextDecide = z.object({ decision: z.enum(["accept", "reject"]), reason: z.string().max(400).optional() });
export const ContextMember = z.object({ user: z.string().min(3).max(200), name: z.string().max(80).optional(), permission: z.enum(["editor", "viewer"]), role: FunctionalRole });
export const ContextRole = z.object({ role: FunctionalRole });
export const ContextComment = z.object({ fragmentId: z.string().optional(), threadId: z.string().optional(), text: z.string().min(1).max(4000) });
export const ContextResolve = z.object({ resolved: z.boolean() });
export const ContextSignOff = z.object({ state: z.enum(["approved", "changes"]) });
export const ContextTool = z.object({ app: z.string().optional(), input: z.unknown().optional() });

export const contextRoutes: Route[] = [
  { method: "get", path: base, summary: "An App's Context: its version, the caller's place in it, members, proposals, changes, what the agent is doing and the thread's turns", scope: "read", tag: S },
  { method: "get", path: `${base}/sync`, summary: "The Context document as server-sent events: its state, then each Yjs update and presence change, and `changed` when the rest moved", scope: "read", tag: S },
  { method: "post", path: `${base}/sync`, summary: "Send a page's Yjs update (editors only) or presence to the Context document", scope: "send", body: ContextSync, tag: S },
  { method: "post", path: `${base}/prompt`, summary: "Ask the agent for something on the Context's thread; a viewer's request yields proposals", scope: "send", body: ContextPrompt, tag: S },
  { method: "post", path: `${base}/draft`, summary: "Start the agent drafting an empty Context from the App's code and earlier conversations; once per App, editors only", scope: "send", tag: S },
  { method: "post", path: `${base}/build`, summary: "Build or update the prototype from the Context as it is now", scope: "send", tag: S },
  { method: "post", path: `${base}/stop`, summary: "Stop the agent's turn on the Context's thread", scope: "send", tag: S },
  { method: "post", path: `${base}/questions/{question}/answer`, summary: "Answer a question the agent asked; a viewer's answer is a proposal", scope: "send", body: ContextAnswer, tag: S },
  { method: "post", path: `${base}/questions/{question}/reopen`, summary: "Open an answered question again", scope: "send", tag: S },
  { method: "post", path: `${base}/questions/continue`, summary: "Go on with what is answered; the agent assumes the rest", scope: "send", tag: S },
  { method: "post", path: `${base}/proposals`, summary: "Propose a change to the Context", scope: "send", body: ContextPropose, tag: S },
  { method: "post", path: `${base}/proposals/{proposal}/decide`, summary: "Accept or reject a proposal (editors)", scope: "send", body: ContextDecide, tag: S },
  { method: "post", path: `${base}/members`, summary: "Add a member, or change what a member may do and their role (the owner)", scope: "send", body: ContextMember, tag: S },
  { method: "delete", path: `${base}/members/{user}`, summary: "Remove a member (the owner)", scope: "send", tag: S },
  { method: "post", path: `${base}/role`, summary: "Set the caller's own functional role: what they review", scope: "send", body: ContextRole, tag: S },
  { method: "post", path: `${base}/threads`, summary: "Comment on a fragment: start a thread, or reply in one", scope: "send", body: ContextComment, tag: S },
  { method: "post", path: `${base}/threads/{thread}/resolve`, summary: "Resolve a thread, or open it again", scope: "send", body: ContextResolve, tag: S },
  { method: "post", path: `${base}/fragments/{fragment}/signoff`, summary: "Sign a fragment off for the caller's role at its current version, or ask for changes", scope: "send", body: ContextSignOff, tag: S },
  { method: "post", path: `${base}/fragments/{fragment}/review-request`, summary: "Ask a role to review a fragment", scope: "send", body: ContextRole, tag: S },
  { method: "get", path: `${base}/brief`, summary: "The Brief: five lines written from the Context at its current version", scope: "read", tag: S },
  { method: "post", path: `${base}/seen`, summary: "Record that the caller has seen the Context at its current version", scope: "send", tag: S },
  { method: "get", path: `${base}/preview`, summary: "The prototype's preview", scope: "read", tag: S },
  { method: "get", path: `${base}/export`, summary: "The Context as it ships in the repository: Markdown (docs/context.md) and its fragments and questions (docs/context.json, null while it has no fragment)", scope: "read", tag: S },
  {
    method: "post",
    path: "/api/v1/studio/context/tools/{name}",
    summary: `Run one of the agent's Context tools (${CONTEXT_TOOL_NAMES.join(", ")}). With a run's token the App is the run's and writes follow the permission of the person who prompted its turn`,
    scope: "send",
    body: ContextTool,
    tag: S,
  },
];

const services = new WeakMap<Kiln, ContextService>();
/** The server's Context service: one per Kiln, made on first use. */
export function contextFor(kiln: Kiln, studio: Studio): ContextService {
  let s = services.get(kiln);
  if (!s) services.set(kiln, (s = new ContextService({ store: kiln.store, objects: kiln.objects, bus: kiln.bus, clock: kiln.clock, studio })));
  return s;
}

/** The Context as the files it ships as in the App's repository; undefined while it has no fragment. */
export function contextRepoFiles(out: ContextExport | undefined): { message: string; files: Record<string, string> } | undefined {
  if (!out) return undefined;
  return { message: "Update the Context export", files: { "docs/context.md": `${out.markdown}\n`, "docs/context.json": `${JSON.stringify(out.json, null, 2)}\n` } };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

type Handler = (c: Context<Env>) => Promise<Response> | Response;

export function registerContext(ctx: RouteContext, deps: { studio: () => Studio; wrap: (fn: Handler) => Handler }) {
  const { app, kiln } = ctx;
  const { wrap } = deps;
  const service = () => contextFor(kiln, deps.studio());
  const id = (c: Context<Env>) => c.req.param("id")!;

  /**
   * The signed-in person. Looking needs read; every change, a viewer's proposal included, needs send,
   * like the rest of the API. Someone who may only read can watch the Context and is a viewer of it.
   */
  const person = (c: Context<Env>, scope: Scope = "read"): ContextPerson => {
    ctx.need(c, scope, "*");
    const user = ctx.user(c);
    let mayWrite = true;
    try {
      ctx.need(c, "send", "*");
    } catch {
      mayWrite = false;
    }
    return { user: user.email, name: user.name, team: ctx.team(c).id, mayWrite };
  };

  app.get(
    "/api/v1/studio/apps/:id/context",
    wrap(async (c) => c.json(await service().snapshot(id(c), person(c)))),
  );

  app.get(
    "/api/v1/studio/apps/:id/context/sync",
    wrap(async (c) => {
      const who = person(c);
      const appId = id(c);
      const s = service();
      const first = await s.syncState(appId, who);
      // The page's Yjs client id: its presence is dropped when the stream closes.
      const clientId = Number(c.req.query("awareness") ?? NaN);
      return streamSSE(c, async (stream) => {
        let queue: Promise<unknown> = stream.writeSSE({ event: "state", data: JSON.stringify({ update: b64(first.update), awareness: b64(first.awareness) }) });
        const write = (e: ContextEvent) => {
          if (stream.aborted) return;
          const data = e.type === "changed" ? "{}" : JSON.stringify({ u: b64(e.update), ...(e.from ? { from: e.from } : {}) });
          queue = queue.then(() => stream.writeSSE({ event: e.type, data })).catch(() => undefined);
        };
        const off = await s.subscribe(appId, who, write);
        const ping = setInterval(() => write({ type: "changed" }), 25_000);
        await new Promise<void>((resolve) => stream.onAbort(resolve));
        clearInterval(ping);
        off();
        if (Number.isFinite(clientId)) await s.leave(appId, [clientId]);
        await queue;
      });
    }),
  );

  app.post(
    "/api/v1/studio/apps/:id/context/sync",
    wrap(async (c) => {
      const who = person(c, "send");
      const body = ContextSync.parse(await c.req.json());
      const s = service();
      if (body.update) await s.applyUpdate(id(c), who, bytes(body.update), body.client);
      if (body.awareness) await s.applyAwareness(id(c), who, bytes(body.awareness), body.client);
      return c.json({ ok: true });
    }),
  );

  app.post(
    "/api/v1/studio/apps/:id/context/prompt",
    wrap(async (c) => c.json(await service().prompt(id(c), person(c, "send"), ContextPrompt.parse(await c.req.json()).text))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/draft",
    wrap(async (c) => c.json(await service().draft(id(c), person(c, "send")))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/build",
    wrap(async (c) => {
      await service().build(id(c), person(c, "send"));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/stop",
    wrap(async (c) => {
      await service().stop(id(c), person(c, "send"));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/questions/continue",
    wrap(async (c) => {
      await service().continueQuestions(id(c), person(c, "send"));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/questions/:question/answer",
    wrap(async (c) => c.json(await service().answer(id(c), person(c, "send"), c.req.param("question")!, ContextAnswer.parse(await c.req.json()).answer))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/questions/:question/reopen",
    wrap(async (c) => {
      await service().reopen(id(c), person(c, "send"), c.req.param("question")!);
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/proposals",
    wrap(async (c) => c.json(await service().propose(id(c), person(c, "send"), ContextPropose.parse(await c.req.json())), 201)),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/proposals/:proposal/decide",
    wrap(async (c) => {
      const body = ContextDecide.parse(await c.req.json());
      return c.json(await service().decideProposal(id(c), person(c, "send"), c.req.param("proposal")!, body.decision, body.reason));
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/members",
    wrap(async (c) => c.json(await service().setMember(id(c), person(c, "send"), ContextMember.parse(await c.req.json())))),
  );
  app.delete(
    "/api/v1/studio/apps/:id/context/members/:user",
    wrap(async (c) => {
      await service().removeMember(id(c), person(c, "send"), decodeURIComponent(c.req.param("user")!));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/role",
    wrap(async (c) => c.json(await service().setRole(id(c), person(c, "send"), ContextRole.parse(await c.req.json()).role))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/threads",
    wrap(async (c) => c.json(await service().comment(id(c), person(c, "send"), ContextComment.parse(await c.req.json())), 201)),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/threads/:thread/resolve",
    wrap(async (c) => c.json(await service().resolveThread(id(c), person(c, "send"), c.req.param("thread")!, ContextResolve.parse(await c.req.json()).resolved))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/fragments/:fragment/signoff",
    wrap(async (c) => c.json(await service().signOff(id(c), person(c, "send"), c.req.param("fragment")!, ContextSignOff.parse(await c.req.json()).state))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/fragments/:fragment/review-request",
    wrap(async (c) => {
      await service().requestReview(id(c), person(c, "send"), c.req.param("fragment")!, ContextRole.parse(await c.req.json()).role);
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/v1/studio/apps/:id/context/brief",
    wrap(async (c) => c.json(await service().brief(id(c), person(c)))),
  );
  app.post(
    "/api/v1/studio/apps/:id/context/seen",
    wrap(async (c) => {
      await service().markSeen(id(c), person(c, "send"));
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/v1/studio/apps/:id/context/preview",
    wrap(async (c) => c.json(await service().preview(id(c), person(c)))),
  );
  app.get(
    "/api/v1/studio/apps/:id/context/export",
    wrap(async (c) => {
      const who = person(c);
      await service().snapshot(id(c), who);
      const out = await service().export(id(c));
      return c.json({ markdown: out?.markdown ?? (await service().markdown(id(c))), json: out?.json ?? null });
    }),
  );

  app.post(
    "/api/v1/studio/context/tools/:name",
    wrap(async (c) => {
      const body = ContextTool.parse(await c.req.json().catch(() => ({})));
      const name = c.req.param("name")!.replace(/^context_(ask|link_preview|mark_built)$/, "$1");
      const run = c.get("run");
      if (!run) {
        if (!body.app) throw new HttpError(400, "app is required");
        return c.json(await service().tool(body.app, person(c, "send"), name, body.input));
      }
      // An App's run: the App is the run's own, and the person is whoever prompted the turn it is on.
      const appId = run.factory.startsWith("app:") ? run.factory.slice(4) : undefined;
      const found = appId ? deps.studio().getApp(appId) : undefined;
      if (!appId || !found) throw new HttpError(403, "only a Studio App's run has a Context");
      const turns = kiln.store.list<Turn>(COLLECTIONS.turns, (t) => t.appId === appId && (t.runId === run.runId || t.runId === run.rootRunId));
      const turn = turns.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
      if (!turn) throw new StudioError("unavailable", "this run has no turn yet; try again in a moment");
      // A viewer's turn runs read-only (chat mode), which is how its permission is known here.
      const who: ContextPerson = { user: turn.by, team: found.app.team, mayWrite: turn.mode === "build" };
      return c.json(await service().tool(appId, who, name, body.input, { id: turn.id }));
    }),
  );
}
