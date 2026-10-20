import { z } from "zod";

export const SCHEMA_VERSION = "kiln/v1" as const;

const name = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

export const HarnessType = z.enum(["claude-code", "codex", "opencode"]);
export type HarnessType = z.infer<typeof HarnessType>;

export const Harness = z
  .object({
    type: HarnessType,
    model: z.string().optional(),
    reasoningLevel: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

/** Keys an agent, automation or agentDefaults may set. `null` clears an inherited value. */
const executionShape = {
  harness: Harness.nullable().optional(),
  model: z.string().nullable().optional(),
  runner: z.string().nullable().optional(),
  secrets: z.array(z.string()).nullable().optional(),
  mcpServers: z.array(z.string()).nullable().optional(),
};

export const Repository = z
  .object({
    forge: z.enum(["github", "gitlab"]).default("github"),
    owner: z.string().min(1),
    name: z.string().min(1),
    deferred: z.boolean().default(false),
  })
  .strict();

export const Factory = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    name: z.string().min(1).max(100),
    alias: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
    description: z.string().optional(),
    project: z.string().optional(),
    repositories: z.array(Repository).min(1),
    integrations: z.array(z.enum(["github", "gitlab", "slack", "linear", "jira"])).default([]),
    agentDefaults: z.object(executionShape).strict(),
    selfImprovement: z
      .object({
        failedRunThreshold: z.number().int().min(1).max(50).default(25),
        maxAgeDays: z.number().int().min(1).max(90).default(7),
        reviewers: z
          .object({
            type: z.enum(["admins", "team", "custom", "none"]).default("admins"),
            emails: z.array(z.string().email()).optional(),
          })
          .strict()
          .default({ type: "admins" }),
      })
      .strict()
      .optional(),
    defaultPipeline: z.string().optional(),
    budgets: z
      .object({ perWorkItemUsd: z.number().positive().optional(), monthlyUsd: z.number().positive().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type Factory = z.infer<typeof Factory>;

export const AgentType = z.enum([
  "FOREMAN",
  "TRIAGE",
  "SPEC",
  "IMPLEMENT",
  "REVIEW",
  "VERIFY",
  "PLAN",
  "PO_ASSISTANT",
  "CUSTOM",
]);
export type AgentType = z.infer<typeof AgentType>;

export const AgentFrontmatter = z
  .object({
    description: z.string().optional(),
    agentType: AgentType.default("CUSTOM"),
    spawnableBy: z.array(z.string()).optional(),
    idleTimeoutMinutes: z.number().int().min(1).max(60).optional(),
    ...executionShape,
  })
  .strict();
export type AgentFrontmatter = z.infer<typeof AgentFrontmatter>;

export const TriggerProvider = z.enum([
  "github",
  "gitlab",
  "linear",
  "jira",
  "slack",
  "factory",
  "schedule",
  "webhook",
  "kiln",
]);

export const Trigger = z
  .object({
    provider: TriggerProvider,
    event: z.string().min(1),
    filter: z.record(z.string(), z.unknown()).optional(),
    schedule: z.object({ cron: z.string(), name: z.string().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.provider === "schedule" && !t.schedule) {
      ctx.addIssue({ code: "custom", message: "schedule triggers need a schedule.cron", path: ["schedule"] });
    }
  });
export type Trigger = z.infer<typeof Trigger>;

export const AutomationFrontmatter = z
  .object({
    enabled: z.boolean().default(true),
    agent: z.string().optional(),
    displayName: z.string().nullable().optional(),
    triggers: z.array(Trigger).min(1),
    ...executionShape,
  })
  .strict();
export type AutomationFrontmatter = z.infer<typeof AutomationFrontmatter>;

export const PipelineStage = z
  .object({
    id: name,
    agent: z.string().optional(),
    action: z.enum(["preview.deploy", "handoff"]).optional(),
    skip_if: z.string().optional(),
    gate: z.string().optional(),
    fan_out: z.enum(["per_user_story"]).optional(),
    requires: z.array(z.enum(["ci_green", "criteria_videos", "tests_pass"])).optional(),
    on_fail: z.string().optional(),
    max_loops: z.number().int().min(1).max(10).optional(),
    advisory: z.boolean().optional(),
  })
  .strict()
  .refine((s) => Boolean(s.agent) !== Boolean(s.action), { message: "a stage needs exactly one of agent or action" });
export type PipelineStage = z.infer<typeof PipelineStage>;

export const Pipeline = z
  .object({
    description: z.string().optional(),
    stages: z.array(PipelineStage).min(1),
    budget: z.object({ maxUsd: z.number().positive() }).strict().optional(),
  })
  .strict();
export type Pipeline = z.infer<typeof Pipeline>;

export const Duration = z.string().regex(/^\d+(m|h|d)$/, "use a duration like 30m, 24h or 3d");

export const Gate = z
  .object({
    kind: z.enum(["approval", "question", "preview", "merge", "custom"]),
    approvers: z.array(z.string()).min(1),
    evidence: z.array(z.string()).optional(),
    nudge: Duration.optional(),
    expire: z
      .string()
      .regex(/^\d+(m|h|d)( -> (park|reject|approve))?$/, "use a duration, optionally followed by -> park|reject|approve")
      .optional(),
    rule: z.string().optional(),
  })
  .strict();
export type Gate = z.infer<typeof Gate>;

export const Policy = z
  .object({
    description: z.string().optional(),
    protectedPaths: z.array(z.string()).optional(),
    twoApprovalPaths: z.array(z.string()).optional(),
    deniedActions: z.array(z.string()).optional(),
    allowedTriggerers: z.array(z.string()).optional(),
    maxUsdPerWorkItem: z.number().positive().optional(),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;

export const Runner = z
  .object({
    description: z.string().optional(),
    image: z.string().min(1),
    backend: z.enum(["docker", "kubernetes", "local"]).default("docker"),
    shape: z.object({ vcpus: z.number().int().positive(), memoryGb: z.number().positive() }).strict().optional(),
    setupCommands: z.array(z.string()).default([]),
    egress: z.array(z.string()).default([]),
  })
  .strict();
export type Runner = z.infer<typeof Runner>;

export const Router = z
  .discriminatedUnion("type", [
    z
      .object({
        name: z.string().optional(),
        type: z.literal("complexity"),
        default: z.string(),
        routing: z.object({ easy: z.string().optional(), medium: z.string().optional(), hard: z.string().optional() }).strict(),
      })
      .strict(),
    z
      .object({
        name: z.string().optional(),
        type: z.literal("prompt"),
        default: z.string(),
        routing: z.array(z.object({ description: z.string(), model: z.string() }).strict()).min(1),
      })
      .strict(),
  ]);
export type Router = z.infer<typeof Router>;

export const ScorerFrontmatter = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agents: z.array(z.string()).min(1),
    labels: z
      .array(z.object({ value: z.string(), score: z.number().min(0).max(1), description: z.string().optional() }).strict())
      .min(1)
      .max(20),
    passingScore: z.number().min(0).max(1),
    samplingRate: z.number().min(0).max(100).default(25),
    model: z.string(),
    selfImprovement: z.boolean().default(false),
  })
  .strict();
export type ScorerFrontmatter = z.infer<typeof ScorerFrontmatter>;

export const BenchmarkSuite = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string(),
    configurations: z
      .array(
        z
          .object({
            name: z.string(),
            agents: z
              .array(z.object({ agent: z.string(), model: z.string().optional(), harness: Harness.optional() }).strict())
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    tasks: z.array(z.string()).min(1),
  })
  .strict();
export type BenchmarkSuite = z.infer<typeof BenchmarkSuite>;

export const BenchmarkTask = z
  .object({
    title: z.string(),
    prompt: z.string(),
    successCriteria: z.array(z.string()).min(1),
    startingRepoRefs: z.array(z.string().regex(/^(github|gitlab)\.com:[^/]+\/[^@]+@[0-9a-f]{40}$/)).min(1),
    sourceRunId: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();
export type BenchmarkTask = z.infer<typeof BenchmarkTask>;

export const SkillFrontmatter = z
  .object({
    name: z.string(),
    description: z.string(),
    owner: z.string().optional(),
    version: z.string().optional(),
  })
  .strict();
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export const Webhook = z
  .object({
    enabled: z.boolean().default(true),
    authMode: z.enum(["token", "url_token", "signature"]).default("token"),
    signatureScheme: z.enum(["github", "standard_webhooks", "stripe", "sentry"]).optional(),
    secretName: z.string(),
    deliveryIdHeader: z.string().optional(),
  })
  .strict()
  .refine((w) => w.authMode !== "signature" || Boolean(w.signatureScheme), {
    message: "signatureScheme is required when authMode is signature",
    path: ["signatureScheme"],
  });
export type Webhook = z.infer<typeof Webhook>;

export const DecisionQuestion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), options: z.array(z.string()).min(2) }).strict(),
  z.object({ type: z.literal("probability") }).strict(),
  z.object({ type: z.literal("score"), min: z.number().default(0), max: z.number().default(1) }).strict(),
]);
export type DecisionQuestion = z.infer<typeof DecisionQuestion>;

export const Decision = z
  .object({
    description: z.string().optional(),
    provider: z.enum(["jev", "llm", "fake"]).default("jev"),
    state: z.array(z.string()).min(1),
    questions: z.record(z.string(), DecisionQuestion),
    policy: z.record(z.string(), z.string()),
    on_error: z.enum(["llm", "allow", "deny"]).default("llm"),
    timeout_ms: z.number().int().positive().default(800),
  })
  .strict();
export type Decision = z.infer<typeof Decision>;

export const MemoryFrontmatter = z
  .object({
    title: z.string(),
    tags: z.array(z.string()).default([]),
    author: z.string().optional(),
  })
  .strict();
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatter>;

/** Every file kind in a definition tree, keyed by the name used in docs and error messages. */
export const fileKinds = {
  factory: Factory,
  agent: AgentFrontmatter,
  automation: AutomationFrontmatter,
  pipeline: Pipeline,
  gate: Gate,
  policy: Policy,
  runner: Runner,
  router: Router,
  scorer: ScorerFrontmatter,
  "benchmark-suite": BenchmarkSuite,
  "benchmark-task": BenchmarkTask,
  skill: SkillFrontmatter,
  webhook: Webhook,
  decision: Decision,
  memory: MemoryFrontmatter,
} as const;
export type FileKind = keyof typeof fileKinds;

export function jsonSchemaFor(kind: FileKind): Record<string, unknown> {
  return z.toJSONSchema(fileKinds[kind], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
export * from "./expr";
