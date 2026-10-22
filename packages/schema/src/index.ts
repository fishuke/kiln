import { z } from "zod";
import { TRIGGER_PROVIDERS, validateSchedules, validateTrigger, type TriggerProviderName } from "./triggers";

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

export const RequiredRepo = z.union([
  z.string().regex(/^[^/\s]+\/[^/\s]+$/, "use owner/name"),
  z
    .object({ owner: z.string().min(1), name: z.string().min(1), codeForge: z.enum(["GITHUB", "GITLAB", "AZURE_DEVOPS", "github", "gitlab"]).optional() })
    .strict(),
]);

/** owner and name of a required repo, whichever form it was written in. */
export function requiredRepoRef(r: z.infer<typeof RequiredRepo>): { owner: string; name: string } {
  if (typeof r !== "string") return { owner: r.owner, name: r.name };
  const [owner, name] = r.split("/");
  return { owner: owner!, name: name! };
}

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
  /** A team environment template (id or name): image, repos, setup commands and secrets. */
  environmentId: z.string().nullable().optional(),
};

export const ForgeName = z.enum(["github", "gitlab", "azure_devops", "bitbucket"]);
export type ForgeName = z.infer<typeof ForgeName>;

export const Repository = z
  .object({
    forge: ForgeName.default("github"),
    owner: z.string().min(1),
    name: z.string().min(1),
    deferred: z.boolean().default(false),
    /** What the repository holds; helps triage pick the repository in a factory with several. */
    description: z.string().optional(),
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

const ChatSettings = {
  /** When true (default), plain replies in a factory thread continue the work; when false a mention is required. */
  autoRespondToThreadReplies: z.boolean().optional(),
};

export const IntegrationType = z.enum(["slack", "microsoft-teams", "discord", "linear", "jira"]);
export type IntegrationType = z.infer<typeof IntegrationType>;

const TeamsChannelId = z.string().regex(/^19:.+@thread\.(tacv2|skype)$/, "use a Teams channel id (19:…@thread.tacv2)");

/** One entry of factory.yaml `integrations`; settings live under the key named after the type. */
export const FactoryIntegration = z.union([
  z.enum(["github", "gitlab", "slack", "linear", "jira", "discord", "microsoft-teams", "teams", "azure_devops", "bitbucket"]),
  z
    .object({
      type: z.string().min(1),
      slack: z
        .object({ ...ChatSettings, channels: z.array(z.string()).optional() })
        .strict()
        .optional(),
      "microsoft-teams": z
        .object({ ...ChatSettings, teams: z.array(z.object({ teamId: z.string().min(1), channelIds: z.array(TeamsChannelId).min(1) }).strict()).optional() })
        .strict()
        .optional(),
      discord: z
        .object({ ...ChatSettings, guildIds: z.array(z.string()).optional(), channelIds: z.array(z.string()).optional() })
        .strict()
        .optional(),
      linear: z
        .object({
          teams: z.array(z.string()).optional(),
          teamIds: z.array(z.string()).optional(),
          /** Workflow states, by name, to move issues to at hand-off and when the work is done (instead of the first started and completed ones). */
          states: z
            .object({ handoff: z.string().min(1).optional(), done: z.string().min(1).optional() })
            .strict()
            .optional(),
          /** Linear users (id, email or name) who may start work here; unset lets everyone. */
          allowUsers: z.array(z.string().min(1)).optional(),
          /** Linear users (id, email or name) who may not start work here. */
          blockUsers: z.array(z.string().min(1)).optional(),
        })
        .strict()
        .optional(),
      jira: z
        .object({ projects: z.array(z.string()).optional(), projectKeys: z.array(z.string()).optional() })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((i, ctx) => {
      for (const key of ["slack", "microsoft-teams", "discord", "linear", "jira"] as const) {
        if (i[key] && i.type !== key) ctx.addIssue({ code: "custom", path: [key], message: `${key} settings are only valid when type is ${key}` });
      }
      if (!["slack", "microsoft-teams", "teams", "discord", "linear", "jira", "github", "gitlab", "azure_devops", "bitbucket"].includes(i.type)) {
        ctx.addIssue({ code: "custom", path: ["type"], message: `unknown integration ${i.type}; use slack, microsoft-teams, discord, linear or jira` });
      }
    }),
]);

export type IntegrationSettings = {
  type: IntegrationType;
  slack?: { autoRespondToThreadReplies?: boolean; channels?: string[] };
  "microsoft-teams"?: { autoRespondToThreadReplies?: boolean; teams?: { teamId: string; channelIds: string[] }[] };
  discord?: { autoRespondToThreadReplies?: boolean; guildIds?: string[]; channelIds?: string[] };
  linear?: { teams?: string[]; teamIds?: string[]; states?: { handoff?: string; done?: string }; allowUsers?: string[]; blockUsers?: string[] };
  jira?: { projects?: string[]; projectKeys?: string[] };
};

/** Bare names and objects alike become `{ type, ...settings }`; forges come from repositories and are dropped. */
function normalizeIntegrations(list: z.infer<typeof FactoryIntegration>[]): IntegrationSettings[] {
  const out: IntegrationSettings[] = [];
  for (const entry of list) {
    const obj = typeof entry === "string" ? { type: entry } : entry;
    const type = obj.type === "teams" ? "microsoft-teams" : obj.type;
    if (!(IntegrationType.options as string[]).includes(type)) continue;
    out.push({ ...obj, type } as IntegrationSettings);
  }
  return out;
}

/** Cloud identity federation passed to runs (AWS_ROLE_ARN, GCP workload identity). */
export const CloudProviders = z
  .object({
    aws: z
      .object({ roleArn: z.string().regex(/^arn:aws[a-z-]*:iam::\d{12}:role\/.+/, "use an IAM role ARN") })
      .strict()
      .optional(),
    gcp: z
      .object({
        projectNumber: z.string().regex(/^\d+$/, "quote the project number so YAML keeps it a string"),
        workloadIdentityFederationPoolId: z.string().min(1),
        workloadIdentityFederationProviderId: z.string().min(1),
        serviceAccountEmail: z.string().email().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CloudProviders = z.infer<typeof CloudProviders>;

export const Factory = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    name: z.string().min(1).max(100),
    alias: Alias.optional(),
    description: z.string().optional(),
    project: z.string().optional(),
    repositories: z.array(Repository).min(1),
    /** Integrations this factory opts into (connected once per workspace). Bare names are the legacy form. */
    integrations: z.array(FactoryIntegration).default([]).transform(normalizeIntegrations),
    github: z
      .object({ factoryConfigChecks: z.enum(["main", "all"]).default("main") })
      .strict()
      .optional(),
    automations: z
      .object({ githubOnboardingNotices: z.boolean().default(true) })
      .strict()
      .optional(),
    cloudProviders: CloudProviders.optional(),
    /** Legacy alias of cloudProviders. */
    providers: CloudProviders.optional(),
    credentialStrategy: CredentialStrategy.optional(),
    networkPolicy: NetworkPolicy.optional(),
    /** Avatar image: a URL or an uploaded file key. */
    avatar: z.string().optional(),
    agentDefaults: z.object(executionShape).strict(),
    /** Runner, secrets and MCP servers for scorer judge runs. */
    scorerDefaults: z
      .object({ runner: z.string().optional(), secrets: z.array(z.string()).optional(), mcpServers: z.array(z.string()).optional() })
      .strict()
      .optional(),
    /** Default judge model for scorers and benchmarks. */
    scoring: z.object({ defaultModel: z.string().optional() }).strict().optional(),
    blueprint: Blueprint.optional(),
    /**
     * How the foreman runs a task. `pipeline` (default): Kiln walks the stages. `agent`: the
     * foreman agent plans, dispatches agents, talks to people and is woken by events.
     */
    foreman: z
      .object({
        mode: z.enum(["pipeline", "agent"]).default("pipeline"),
        /** Foreman turns per task before Kiln stops and asks a person. */
        maxTurns: z.number().int().min(1).max(500).default(60),
      })
      .strict()
      .optional(),
    /**
     * One task per incident. A report that matches an open task by identity (alert fingerprint,
     * tracker issue, URL), or from another source by content, joins that task instead.
     */
    deduplication: z
      .object({
        enabled: z.boolean().default(true),
        /** How far back open tasks are compared (by last activity). */
        windowHours: z.number().int().min(1).max(720).default(24),
        /** Share of salient words (service names, error codes, hosts) two reports must have in common. */
        threshold: z.number().min(0.2).max(1).default(0.5),
      })
      .strict()
      .optional(),
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
    budgets: z.object({ perWorkItemUsd: z.number().positive().optional(), monthlyUsd: z.number().positive().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    const types = f.integrations.map((i) => i.type);
    if (types.includes("linear") && types.includes("jira")) {
      ctx.addIssue({ code: "custom", path: ["integrations"], message: "a factory can use Linear or Jira, not both" });
    }
    const dupes = types.filter((t, i) => types.indexOf(t) !== i);
    if (dupes.length) ctx.addIssue({ code: "custom", path: ["integrations"], message: `integration ${dupes[0]} is listed twice` });
    if (f.cloudProviders && f.providers)
      ctx.addIssue({ code: "custom", path: ["providers"], message: "set cloudProviders (providers is its legacy alias), not both" });
  });
export type Factory = z.infer<typeof Factory>;

export const AgentType = z.enum(["FOREMAN", "TRIAGE", "SPEC", "IMPLEMENT", "REVIEW", "VERIFY", "PLAN", "PO_ASSISTANT", "CUSTOM"]);
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

export const TriggerProvider = z.enum(TRIGGER_PROVIDERS as [TriggerProviderName, ...TriggerProviderName[]]);

/** One trigger: provider and event from the catalogue, a filter whose keys depend on both, and an inline schedule for cron. */
export const Trigger = z
  .object({
    provider: TriggerProvider,
    event: z.string().min(1),
    filter: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .transform((f) => f ?? undefined),
    schedule: z
      .object({ cron: z.string().min(1), name: z.string().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    for (const p of validateTrigger(t)) ctx.addIssue({ code: "custom", message: p.message, path: p.path });
  });
export type Trigger = z.infer<typeof Trigger>;

export const AutomationFrontmatter = z
  .object({
    enabled: z.boolean().default(true),
    agent: z.string().optional(),
    displayName: z.string().nullable().optional(),
    triggers: z.array(Trigger).min(1),
    ...executionShape,
    /** Execution overrides for runs this automation starts (environmentId, runner… come from executionShape). */
    workerHost: z.string().min(1).nullable().optional(),
    computerUseModel: z.string().min(1).nullable().optional(),
    idleTimeoutMinutes: z.number().int().min(1).max(60).optional(),
    /** Repositories (owner/name) prepared for every run, in addition to the agent's own. */
    required_repos: z.array(RequiredRepo).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    for (const p of validateSchedules(a.triggers)) ctx.addIssue({ code: "custom", message: p.message, path: ["triggers", ...p.path] });
  });
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
    /** ADR-014: the merge gate may merge pull requests the merge-safety decision finds safe. Off unless a person sets it; `false` in any policy file wins. */
    mergeGate: z.boolean().optional(),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;

export const RunnerPlatform = z
  .object({
    os: z.enum(["linux", "macos", "windows"]).default("linux"),
    arch: z.enum(["x86_64", "aarch64"]).optional(),
    linux: z
      .object({
        dockerImage: z.string().min(1).optional(),
        /** A team secret of type docker_registry or aws_ecr used to pull a private image; its host must match the image's registry. */
        registryCredentialSecretName: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    mac: z
      .object({ version: z.enum(["14", "15", "26", "27"]).default("26") })
      .strict()
      .optional(),
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

/** `image` is unset when the runner names none: each run then uses the server's runner image (KILN_RUNNER_IMAGE). */
type RunnerOut = Omit<z.infer<typeof RunnerInput>, "image" | "shape"> & { image?: string; shape?: z.infer<typeof Shape> };

export const Runner = RunnerInput.transform((r): RunnerOut => {
  const shape = r.shape ?? r.instanceShape;
  // One place for the pull credential: the top-level v1alpha1 key is folded into platform.linux.
  const registry = r.platform?.linux?.registryCredentialSecretName ?? r.registryCredentialSecretName;
  const platform = registry
    ? { ...(r.platform ?? { os: "linux" as const }), linux: { ...r.platform?.linux, registryCredentialSecretName: registry } }
    : r.platform;
  const image = r.image ?? r.platform?.linux?.dockerImage;
  const { image: _image, ...rest } = r;
  return { ...rest, ...(image ? { image } : {}), ...(shape ? { shape } : {}), ...(platform ? { platform } : {}) };
});
export type Runner = z.infer<typeof Runner>;

export const Router = z.discriminatedUnion("type", [
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
            agents: z.array(z.object({ agent: z.string(), model: z.string().optional(), harness: Harness.optional() }).strict()).optional(),
            /** Runner every task of this configuration uses (runners/<name>.yaml). */
            runner: z.string().optional(),
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

export const SignatureScheme = z.enum(["github", "pagerduty", "sentry", "standard_webhooks", "stripe", "vercel"]);
export type SignatureScheme = z.infer<typeof SignatureScheme>;
export const WebhookAuthMode = z.enum(["token", "url_token", "signature"]);
export type WebhookAuthMode = z.infer<typeof WebhookAuthMode>;

/** Headers that carry credentials or signatures can't serve as a delivery id. */
const CREDENTIAL_HEADERS =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-hub-signature(-256)?|stripe-signature|sentry-hook-signature|x-vercel-signature|x-pagerduty-signature|webhook-signature|x-api-key)$/i;
export const DeliveryIdHeader = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "use a valid HTTP header name")
  .refine((h) => !CREDENTIAL_HEADERS.test(h), "this header can carry a credential; use the sender's delivery id header");

export const Webhook = z
  .object({
    enabled: z.boolean().default(true),
    authMode: WebhookAuthMode.default("token"),
    signatureScheme: SignatureScheme.optional(),
    secretName: z.string().min(1),
    deliveryIdHeader: DeliveryIdHeader.optional(),
  })
  .strict()
  .refine((w) => w.authMode !== "signature" || Boolean(w.signatureScheme), {
    message: "signatureScheme is required when authMode is signature",
    path: ["signatureScheme"],
  })
  .refine((w) => w.authMode === "signature" || !w.signatureScheme, {
    message: "signatureScheme is only valid when authMode is signature",
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
export * from "./triggers";
export * from "./cron";
