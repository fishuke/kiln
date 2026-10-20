import { SCOPES } from "@kiln/auth";
import { z } from "zod";

export const Tree = z.object({ tree: z.record(z.string(), z.string()) });
export const TreeFor = Tree.extend({ factory: z.string() });
export const Apply = Tree.extend({ factory: z.string().optional(), canaryPercent: z.number().min(1).max(100).optional(), dryRun: z.boolean().optional() });
export const Connect = z.object({ owner: z.string(), name: z.string(), ref: z.string().optional(), dir: z.string().optional() });
/** An uploaded file: its key from POST /api/v1/uploads, or the whole attachment object. */
export const AttachmentRef = z.union([z.string().min(1), z.object({ key: z.string().min(1), name: z.string().optional(), contentType: z.string().optional(), size: z.number().optional() })]);
export const Attachments = z.array(AttachmentRef).max(25);
export const RunMode = z.enum(["normal", "plan", "orchestrate"]);

export const CreateWorkItem = z.object({
  factory: z.string(),
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  projectId: z.string().optional(),
  pipeline: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  via: z.enum(["api", "kiln", "mcp", "cli"]).optional(),
  attachments: Attachments.optional(),
  mode: RunMode.optional(),
});
export const Message = z.object({ text: z.string().min(1), attachments: Attachments.optional() });

const list = <T extends z.ZodType>(item: T) => z.preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v.flatMap((x) => String(x).split(",")) : String(v).split(",")), z.array(item).optional());
const int = (max: number) => z.coerce.number().int().min(1).max(max).optional();

export const RunListQuery = z
  .object({
    state: list(z.enum(["QUEUED", "PENDING", "CLAIMED", "INPROGRESS", "SUCCEEDED", "FAILED", "BLOCKED", "ERROR", "CANCELLED"])),
    task_status: list(z.enum(["running", "failed", "blocked", "cancelled", "complete"])),
    source: list(z.string()),
    factory_uid: list(z.string()),
    factory: z.string().optional(),
    workItem: z.string().optional(),
    task_id: z.string().optional(),
    agent: z.string().optional(),
    name: z.string().optional(),
    model_id: z.string().optional(),
    kind: z.string().optional(),
    ancestor_run_id: z.string().optional(),
    artifact_type: z.string().optional(),
    q: z.string().optional(),
    creator: z.string().optional(),
    executor: z.string().optional(),
    mine: z.string().optional(),
    created_after: z.string().optional(),
    created_before: z.string().optional(),
    updated_after: z.string().optional(),
    sort_by: z.enum(["created_at", "updated_at", "title", "agent"]).optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
    limit: int(500),
    cursor: z.string().optional(),
  })
  .passthrough();
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
