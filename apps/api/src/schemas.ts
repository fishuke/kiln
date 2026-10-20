import { SCOPES } from "@kiln/auth";
import { z } from "zod";

export const Tree = z.object({ tree: z.record(z.string(), z.string()) });
export const TreeFor = Tree.extend({ factory: z.string() });
export const Apply = Tree.extend({ factory: z.string().optional(), canaryPercent: z.number().min(1).max(100).optional(), dryRun: z.boolean().optional() });
export const Connect = z.object({ owner: z.string(), name: z.string(), ref: z.string().optional(), dir: z.string().optional() });
export const CreateWorkItem = z.object({
  factory: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  projectId: z.string().optional(),
  pipeline: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  via: z.enum(["api", "kiln", "mcp"]).optional(),
});
export const Message = z.object({ text: z.string().min(1) });
export const Replay = z.object({ sha: z.string().optional() });
export const SaveBenchmark = z.object({ suite: z.string(), slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().optional(), successCriteria: z.array(z.string()).optional(), tags: z.array(z.string()).optional() });
export const Decide = z.object({ decision: z.enum(["approve", "reject", "answer"]), answer: z.string().optional(), via: z.string().optional() });
export const Project = z.object({ name: z.string().min(1), factories: z.array(z.string()).min(1) });
export const Plan = z.object({ goal: z.string().min(1), prd: z.string().optional(), notes: z.string().optional(), createIssues: z.boolean().optional() });
export const Memory = z.object({ title: z.string().min(1), body: z.string().min(1), tags: z.array(z.string()).optional() });
export const Publish = z.object({ factory: z.string(), name: z.string() });
export const Install = z.object({ factory: z.string() });
export const Guard = z.object({ command: z.string(), cwd: z.string().optional() });
export const Token = z.object({
  name: z.string(),
  subject: z.string(),
  grants: z.array(z.object({ scope: z.enum(SCOPES), factory: z.string() })).min(1),
  ttlHours: z.number().positive().optional(),
});
