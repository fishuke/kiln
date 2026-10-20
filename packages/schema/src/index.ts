import { z } from "zod";

export const SCHEMA_VERSION = "kiln/v1" as const;

const name = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

export const HarnessType = z.enum(["claude-code", "codex", "opencode", "gemini", "pi"]);
export type HarnessType = z.infer<typeof HarnessType>;

/**
 * Bring your own keys. `secret` names a Kiln secret whose value is passed to the harness, e.g. a
 * Claude subscription token from `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) or an API key.
 * `worker` uses credentials already present on a self-hosted worker.
 */
export const HarnessAuth = z.discriminatedUnion("source", [
  z.object({ source: z.literal("secret"), secretName: z.string().min(1), env: z.string().optional() }).strict(),
  z.object({ source: z.literal("worker") }).strict(),
  /** v1alpha1 spellings, accepted as they are: `managedSecret` = `secret`, `workerEnvironment` = `worker`. */
  z.object({ source: z.literal("managedSecret"), secretName: z.string().min(1), env: z.string().optional() }).strict(),
  z.object({ source: z.literal("workerEnvironment") }).strict(),
]);
export type HarnessAuth = z.infer<typeof HarnessAuth>;

export const Harness = z
  .object({
    type: HarnessType,
    model: z.string().optional(),
    reasoningLevel: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    auth: HarnessAuth.nullable().optional(),
  })
  .strict();

/** Literal hosts or IPs: no URLs, ports, CIDRs or wildcards. */
const Host = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9.-]+$|^[0-9a-fA-F:]+$/, "use a literal host name or IP (no scheme, port, CIDR or wildcard)");

/** Egress for the agent's sandbox. When set, hosts that are not allowed are blocked. */
export const NetworkPolicy = z
  .object({
    allowedHosts: z.array(Host).optional(),
    deniedHosts: z.array(Host).optional(),
    extends: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();
export type NetworkPolicy = z.infer<typeof NetworkPolicy>;

/** Whose forge identity a run uses: the agent (EXECUTOR) or the person who started the run (CREATOR). */
export const CredentialStrategy = z.enum(["EXECUTOR", "CREATOR"]);
export type CredentialStrategy = z.infer<typeof CredentialStrategy>;

export const RequiredRepo = z
  .object({ owner: z.string().min(1), name: z.string().min(1), codeForge: z.enum(["GITHUB", "GITLAB", "AZURE_DEVOPS", "github", "gitlab"]).optional() })
  .strict();

/** A self-hosted worker id (`kiln worker --worker-id`). */
export const WorkerHost = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "use letters, digits, dots, dashes and underscores");

/** Keys an agent, automation or agentDefaults may set. `null` clears an inherited value. */
const executionShape = {
  harness: Harness.nullable().optional(),
  model: z.string().nullable().optional(),
  runner: z.string().nullable().optional(),
  secrets: z.array(z.string()).nullable().optional(),
  mcpServers: z.array(z.string()).nullable().optional(),
  /** Run on a self-hosted worker connected with this id. Null or "" runs on the Kiln server. */
  workerHost: WorkerHost.or(z.literal("")).nullable().optional(),
  /** Model for computer use (screenshots, recordings). Omit for automatic selection. */
  computerUseModel: z.string().nullable().optional(),
  /** Turn computer use (screenshots, recordings of the running app) on or off. */
  computerUse: z.boolean().nullable().optional(),
};

export const Repository = z
  .object({
    forge: z.enum(["github", "gitlab"]).default("github"),
    owner: z.string().min(1),
    name: z.string().min(1),
    deferred: z.boolean().default(false),
  })
  .strict();

/**
 * An explicit workflow graph. When present the foreman path executes it: a task enters at
 * `entry`, each stage runs its staffed agent with the stage prompt, and the first edge whose
 * condition holds picks the next stage. A stage with no edge that holds ends the workflow.
 */
export const Blueprint = z
  .object({
    entry: z.string().min(1),
    stages: z
      .record(z.string().min(1), z.object({ prompt: z.string().min(1), inputs: z.string().optional(), outputs: z.string().optional() }).strict())
      .refine((r) => Object.keys(r).length > 0, "a blueprint needs at least one stage")
      .refine((r) => !("foreman" in r), "the stage name foreman is reserved for staffing"),
    edges: z.record(z.string().min(1), z.object({ from: z.string().min(1), to: z.string().min(1), when: z.string().min(1) }).strict()).default({}),
    staffing: z.record(z.string().min(1), z.string().min(1)).refine((r) => "foreman" in r, "staffing needs a foreman"),
  })
  .strict();
export type Blueprint = z.infer<typeof Blueprint>;

/** Letters, digits, spaces, dots, underscores and dashes; up to 60 characters. Case is kept. */
export const Alias = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/, "use up to 60 letters, digits, spaces, dots, underscores or dashes");

export const Factory = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    name: z.string().min(1).max(100),
    alias: Alias.optional(),
    description: z.string().optional(),
    project: z.string().optional(),
    repositories: z.array(Repository).min(1),
    integrations: z.array(z.enum(["github", "gitlab", "slack", "linear", "jira"])).default([]),
    credentialStrategy: CredentialStrategy.optional(),
    networkPolicy: NetworkPolicy.optional(),
    /** Avatar image: a URL or an uploaded file key. */
    avatar: z.string().optional(),
    /** Cloud identities agents may assume (e.g. aws.roleArn, gcp workload identity). */
    cloudProviders: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    agentDefaults: z.object(executionShape).strict(),
    /** Runner, secrets and MCP servers for scorer judge runs. */
    scorerDefaults: z.object({ runner: z.string().optional(), secrets: z.array(z.string()).optional(), mcpServers: z.array(z.string()).optional() }).strict().optional(),
    /** Default judge model for scorers and benchmarks. */
    scoring: z.object({ defaultModel: z.string().optional() }).strict().optional(),
    blueprint: Blueprint.optional(),
    /** Free-form switches for features that are still being tried out. */
    experimental: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    selfImprovement: z
      .object({
        enabled: z.boolean().default(true),
        failedRunThreshold: z.number().int().min(1).max(50).default(25),
        maxAgeDays: z.number().int().min(1).max(90).default(7),
        /** Model for the self-improvement analysis run. */
        model: z.string().optional(),
        /** Scorers whose failures feed self-improvement (slugs, or slug → on/off). */
        scorers: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
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
    idleTimeoutMinutes: z.number().int().min(1).max(60).nullable().optional(),
    credentialStrategy: CredentialStrategy.nullable().optional(),
    networkPolicy: NetworkPolicy.nullable().optional(),
    required_repos: z.array(RequiredRepo).optional(),
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
    required_repos: z.array(RequiredRepo).optional(),
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

export const RunnerPlatform = z
  .object({
    os: z.enum(["linux", "macos", "windows"]).default("linux"),
    arch: z.enum(["x86_64", "aarch64"]).optional(),
    linux: z.object({ dockerImage: z.string().min(1), registryCredentialSecretName: z.string().optional() }).strict().optional(),
    mac: z.object({ version: z.enum(["14", "15", "26", "27"]).default("26") }).strict().optional(),
  })
  .strict();

const Shape = z.object({ vcpus: z.number().int().positive(), memoryGb: z.number().positive() }).strict();

const RunnerInput = z
  .object({
    description: z.string().optional(),
    /** Container image. Optional when `platform.linux.dockerImage` names it. */
    image: z.string().min(1).optional(),
    backend: z.enum(["docker", "kubernetes", "local"]).default("docker"),
    shape: Shape.optional(),
    /** v1alpha1 name for `shape`. */
    instanceShape: Shape.optional(),
    platform: RunnerPlatform.optional(),
    /** Secret holding registry credentials for a private image. */
    registryCredentialSecretName: z.string().optional(),
    setupCommands: z.array(z.string()).default([]),
    egress: z.array(z.string()).default([]),
    /** Keep a failed run's sandbox this many minutes so it can be inspected. */
    failureSessionRetentionMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

type RunnerOut = Omit<z.infer<typeof RunnerInput>, "image" | "shape"> & { image: string; shape?: z.infer<typeof Shape> };

export const Runner = RunnerInput.transform((r): RunnerOut => {
  const shape = r.shape ?? r.instanceShape;
  return { ...r, image: r.image ?? r.platform?.linux?.dockerImage ?? "node:22-bookworm", ...(shape ? { shape } : {}) };
});
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

export const ScorerAgentRef = z.union([z.string(), z.object({ name: z.string(), includeDescendants: z.boolean().default(false) }).strict()]);

/** The agent names a scorer covers, whatever form they were written in. */
export function scorerAgentNames(agents: z.infer<typeof ScorerAgentRef>[]): string[] {
  return agents.map((a) => (typeof a === "string" ? a : a.name));
}

export const ScorerFrontmatter = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    output: z.literal("classification").optional(),
    /** `user` scorers grade runs; `benchmark_task_correctness` grades benchmark trials against their success criteria. */
    kind: z.enum(["user", "benchmark_task_correctness"]).default("user"),
    agents: z.array(ScorerAgentRef).min(1),
    labels: z
      .array(z.object({ value: z.string(), score: z.number().min(0).max(1), description: z.string().optional() }).strict())
      .min(1)
      .max(20),
    passingScore: z.number().min(0).max(1),
    samplingRate: z.number().min(0).max(100).default(25),
    model: z.string(),
    selfImprovement: z.boolean().default(false),
    runner: z.string().optional(),
    secrets: z.array(z.string()).optional(),
    mcpServers: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.labels.length > 1 && (!s.labels.some((l) => l.score >= s.passingScore) || !s.labels.some((l) => l.score < s.passingScore))) {
      ctx.addIssue({ code: "custom", path: ["labels"], message: "labels need at least one passing and one failing value" });
    }
  });
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
    labels: z.array(z.string()).optional(),
    /** A reference PR scorers may compare against. */
    referencePr: z.string().max(2048).optional(),
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
