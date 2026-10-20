import { INBOX_ITEM_KINDS } from "@kiln/engine";
import { z } from "zod";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { flag, limit, listOf, queryObject } from "./util";

export const InboxQuery = z
  .object({
    scope: z.enum(["mine", "team"]).optional(),
    factory: z.string().optional(),
    kind: listOf(z.enum(INBOX_ITEM_KINDS)),
    read: z.enum(["true", "false"]).optional(),
    q: z.string().optional(),
    include_resolved: flag,
    limit: limit(100),
    cursor: z.string().optional(),
  })
  .passthrough();
export const Ids = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });
export const ProposeChange = z.object({ title: z.string().min(1).max(200), message: z.string().optional(), files: z.record(z.string().min(1), z.string().nullable()).refine((f) => Object.keys(f).length > 0, "change at least one file") });
export const Comment = z.object({ text: z.string().min(1), path: z.string().optional(), line: z.number().int().positive().optional() });

export const routes: Route[] = [
  { method: "get", path: "/api/v1/inbox/items", summary: "Inbox items: question, answer_question, spec_review, pr_review, blocked, failed (scope mine|team, factory, kind, read, q)", tag: "Inbox" },
  { method: "post", path: "/api/v1/inbox/read", summary: "Mark items read", body: Ids, tag: "Inbox" },
  { method: "post", path: "/api/v1/inbox/unread", summary: "Mark items unread", body: Ids, tag: "Inbox" },
  { method: "post", path: "/api/v1/inbox/resolve", summary: "Resolve (hide) items for you", body: Ids, tag: "Inbox" },
  { method: "post", path: "/api/v1/inbox/unresolve", summary: "Undo a resolve", body: Ids, tag: "Inbox" },
  { method: "get", path: "/api/v1/factories/{id}/definition-changes", summary: "Proposed definition changes (?state=open|merged|changes_requested|rejected)", scope: "read", tag: "Inbox" },
  { method: "post", path: "/api/v1/factories/{id}/definition-changes", summary: "Propose a definition change for review (agents and people)", scope: "send", body: ProposeChange, tag: "Inbox" },
  { method: "get", path: "/api/v1/definition-changes/{id}", summary: "A proposed change with its diff and comments", scope: "read", tag: "Inbox" },
  { method: "post", path: "/api/v1/definition-changes/{id}/approve", summary: "Approve & merge: apply it (managed) or open the config-repo PR", scope: "definitions:write", tag: "Inbox" },
  { method: "post", path: "/api/v1/definition-changes/{id}/request-changes", summary: "Request changes; the comments go back to the proposing agent", scope: "definitions:write", body: Comment, tag: "Inbox" },
  { method: "post", path: "/api/v1/definition-changes/{id}/comments", summary: "Comment on the diff (optionally a path and line)", scope: "read", body: Comment, tag: "Inbox" },
  { method: "post", path: "/api/v1/definition-changes/{id}/reject", summary: "Reject the change", scope: "definitions:write", tag: "Inbox" },
];

/** The personal inbox and definition-change reviews. */
export function register({ app, kiln, need, who, visible, options }: RouteContext) {
  app.get("/api/v1/inbox/items", (c) => {
    const q = InboxQuery.parse(queryObject(c));
    if (q.factory) need(c, "read", q.factory);
    const scope = q.scope ?? (options.devAuth ? "team" : "mine");
    return c.json(
      kiln.inbox.list({ user: who(c), scope, factory: q.factory, kind: q.kind, read: q.read === undefined ? undefined : q.read === "true", q: q.q, includeResolved: q.include_resolved, limit: q.limit, cursor: q.cursor, visible: (f) => visible(c, f) }),
    );
  });
  for (const action of ["read", "unread", "resolve", "unresolve"] as const) {
    app.post(`/api/v1/inbox/${action}`, async (c) => {
      const { ids } = Ids.parse(await c.req.json());
      const user = who(c);
      const results = action === "read" ? kiln.inbox.markRead(user, ids) : action === "unread" ? kiln.inbox.markUnread(user, ids) : action === "resolve" ? kiln.inbox.resolve(user, ids) : kiln.inbox.undoResolve(user, ids);
      return c.json({ results });
    });
  }

  const change = (id: string) => {
    const ch = kiln.definitionChanges.get(id);
    if (!ch) throw new HttpError(404, "unknown definition change");
    return ch;
  };

  app.get("/api/v1/factories/:id/definition-changes", (c) => {
    const id = c.req.param("id");
    need(c, "read", id);
    const state = c.req.query("state") as "open" | undefined;
    return c.json({ changes: kiln.definitionChanges.list({ factory: id, state }) });
  });
  app.post("/api/v1/factories/:id/definition-changes", async (c) => {
    const id = c.req.param("id");
    need(c, "send", id);
    const body = ProposeChange.parse(await c.req.json());
    const run = c.get("run");
    return c.json(kiln.definitionChanges.propose({ factory: id, title: body.title, message: body.message, files: body.files, by: who(c), runId: run?.runId, workItemId: run?.workItemId }), 201);
  });
  app.get("/api/v1/definition-changes/:id", (c) => {
    const ch = change(c.req.param("id"));
    need(c, "read", ch.factory);
    return c.json(ch);
  });
  app.post("/api/v1/definition-changes/:id/approve", async (c) => {
    const ch = change(c.req.param("id"));
    need(c, "definitions:write", ch.factory);
    return c.json(await kiln.definitionChanges.approve(ch.id, who(c)));
  });
  app.post("/api/v1/definition-changes/:id/request-changes", async (c) => {
    const ch = change(c.req.param("id"));
    need(c, "definitions:write", ch.factory);
    const { text } = Comment.parse(await c.req.json());
    return c.json(await kiln.definitionChanges.requestChanges(ch.id, who(c), text));
  });
  app.post("/api/v1/definition-changes/:id/comments", async (c) => {
    const ch = change(c.req.param("id"));
    need(c, "read", ch.factory);
    return c.json(kiln.definitionChanges.comment(ch.id, who(c), Comment.parse(await c.req.json())), 201);
  });
  app.post("/api/v1/definition-changes/:id/reject", (c) => {
    const ch = change(c.req.param("id"));
    need(c, "definitions:write", ch.factory);
    return c.json(kiln.definitionChanges.reject(ch.id, who(c)));
  });
}
