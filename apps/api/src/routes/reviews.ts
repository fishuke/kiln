import { ReviewError } from "@kiln/engine";
import { z } from "zod";
import type { RouteContext } from "../app";
import { HttpError } from "../app";
import type { Route } from "../openapi";
import { queryObject } from "./util";

export const SubmitReview = z.object({
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  body: z.string().max(65_000).optional(),
  comments: z
    .array(
      z.object({ path: z.string().min(1), line: z.number().int().positive(), side: z.enum(["LEFT", "RIGHT"]).optional(), body: z.string().min(1).max(65_000) }),
    )
    .max(200)
    .optional(),
});
const ReadyQuery = z.object({ factory: z.string().optional() }).passthrough();

export const routes: Route[] = [
  {
    method: "get",
    path: "/api/v1/tasks/{id}/review",
    summary: "The task's pull request for review: changed files with patches, review findings, and whether you can review as your linked GitHub account",
    scope: "read",
    tag: "Tasks",
  },
  {
    method: "post",
    path: "/api/v1/tasks/{id}/review",
    summary: "Submit a review (APPROVE, REQUEST_CHANGES, COMMENT, line comments) as your linked GitHub account; requested changes go to the agents",
    scope: "decide:merge",
    body: SubmitReview,
    tag: "Tasks",
  },
  {
    method: "post",
    path: "/api/v1/tasks/{id}/merge",
    summary: "Merge the task's pull request as your linked GitHub account",
    scope: "decide:merge",
    tag: "Tasks",
  },
  { method: "get", path: "/api/v1/ready-to-merge", summary: "Handed-off tasks that need no code review, only a person's merge (?factory=)", tag: "Tasks" },
];

/** Reviewing and merging factory pull requests in Kiln, as the person (ADR-010). */
export function register({ app, kiln, need, user, visible }: RouteContext) {
  const task = (c: Parameters<typeof need>[0], scope: Parameters<typeof need>[1]) => {
    const wi = kiln.workflow.get(c.req.param("id") ?? "");
    if (!wi) throw new HttpError(404, "unknown task");
    need(c, scope, wi.factory);
    return wi;
  };
  const wrap = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReviewError) throw new HttpError(409, err.message);
      throw err;
    }
  };

  app.get("/api/v1/tasks/:id/review", async (c) => {
    const wi = task(c, "read");
    const files = await wrap(() => kiln.reviews.files(wi.id));
    const gate = kiln.gates.list({ workItemId: wi.id, state: "open" }).find((g) => g.kind === "merge");
    return c.json({
      taskId: wi.id,
      title: wi.title,
      pr: wi.pr,
      state: wi.state,
      needsHuman: wi.review?.needsHuman ?? true,
      findings: wi.review?.findings ?? [],
      verdict: wi.review?.verdict,
      gateId: gate?.id,
      account: kiln.reviews.account(user(c).id),
      files,
    });
  });
  app.post("/api/v1/tasks/:id/review", async (c) => {
    const wi = task(c, "decide:merge");
    const input = SubmitReview.parse(await c.req.json());
    return c.json(await wrap(() => kiln.reviews.submit(wi.id, user(c).id, input)), 201);
  });
  app.post("/api/v1/tasks/:id/merge", async (c) => {
    const wi = task(c, "decide:merge");
    const pr = await wrap(() => kiln.reviews.merge(wi.id, user(c).id));
    return c.json({ pr, task: kiln.workflow.get(wi.id) });
  });
  app.get("/api/v1/ready-to-merge", (c) => {
    const { factory } = ReadyQuery.parse(queryObject(c));
    if (factory) need(c, "read", factory);
    const items = kiln.reviews.readyToMerge(factory).filter((w) => visible(c, w.factory));
    return c.json({
      items: items.map((w) => ({ taskId: w.id, factory: w.factory, title: w.title, pr: w.pr, previewUrl: w.previewUrl, updatedAt: w.updatedAt })),
    });
  });
}
