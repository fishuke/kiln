import type { EvidencePackage } from "@kiln/evidence";
import type { WorkItemState } from "@kiln/events";
import type { DefinitionTree } from "@kiln/definitions";

export type { WorkItemState };

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private t = new Date("2026-10-20T09:00:00Z")) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

export type Source = {
  provider: "github" | "gitlab" | "azure_devops" | "bitbucket" | "linear" | "jira" | "slack" | "teams" | "discord" | "kiln" | "mcp" | "schedule" | "webhook" | "api" | "cli";
  url?: string;
  repo?: string;
  number?: number;
  issueId?: string;
  channel?: string;
  thread?: string;
  automation?: string;
  /** Linear agent session the work reports progress into. */
  sessionId?: string;
  /** The provider user who asked (Slack/Discord/Teams user id), for DMs. */
  user?: string;
  /** Teams: where the conversation lives. */
  serviceUrl?: string;
  /** GitLab: the discussion to reply in. */
  discussionId?: string;
  deliveryId?: string;
};

/** Per-automation execution overrides carried by the work items it starts. */
export type ExecutionOverrides = {
  harness?: string;
  model?: string;
  runner?: string;
  secrets?: string[];
  mcpServers?: string[];
  environmentId?: string;
  workerHost?: string;
  idleTimeoutMinutes?: number;
  requiredRepos?: string[];
};

export type Attachment = { key: string; name: string; contentType: string; size: number };

/** Something a run produced that people look at: screenshots, recordings, reports, the PR, the preview. */
export type Artifact = { kind: "image" | "video" | "file" | "report" | "pr" | "preview"; name: string; url: string; key?: string; contentType?: string; size?: number };

export type ConversationEntry = { at: string; from: string; role: "human" | "foreman" | "agent" | "system"; text: string; attachments?: Attachment[] };

/** How a run is carried out: as asked, plan first and wait for approval, or orchestrate subagents. */
export type RunMode = "normal" | "plan" | "orchestrate";

/** The API-facing task stage. Kiln's finer states map onto these. */
export type TaskStage = "TRIAGE" | "SPEC" | "IMPLEMENT" | "REVIEW" | "COMPLETE" | "CANCELLED";

export type WorkItem = {
  id: string;
  factory: string;
  title: string;
  body: string;
  source: Source;
  requester: string;
  state: WorkItemState;
  /** Set by a person through the API (PATCH stage); cleared by the next workflow state change. */
  stageOverride?: TaskStage;
  mode?: RunMode;
  /** The conversation this task belongs to; defaults to the task id. */
  conversationId?: string;
  deletedAt?: string;
  deletedBy?: string;
  /** Identity keys (alert fingerprint, issue, URL) used to recognise the same incident again. */
  correlationKeys?: string[];
  /** Other places the same work was reported; updates go to each of them. */
  linkedSources?: Source[];
  /** Reports folded into this task. */
  duplicates?: { at: string; requester: string; source: Source; title: string; reason: "key" | "similarity" | "triage"; score?: number; workItemId?: string }[];
  /** Set on a task that was folded into another one. */
  duplicateOf?: string;
  stage?: string;
  pipeline?: string;
  definitionSha: string;
  triage?: { kind: string; size: string; summary?: string; duplicateOf?: string; confidence: number };
  spec?: { path: string; criteria: string[]; stories: string[]; openQuestions: string[] };
  branch?: string;
  pr?: { repo: string; number: number; url: string; openedAt?: string; firstReviewAt?: string; mergedAt?: string; closedAt?: string; additions?: number; deletions?: number; changedFiles?: number; commits?: number; humanCodeChange?: boolean };
  previewUrl?: string;
  previewDeployedAt?: string;
  evidence?: EvidencePackage;
  review?: { verdict: string; findings: string[]; reviewers: string[] };
  loops: Record<string, number>;
  conversation: ConversationEntry[];
  attachments: Attachment[];
  humanTouches: number;
  costUsd: number;
  budgetUsd?: number;
  blockedReason?: string;
  projectId?: string;
  trackerKey?: string;
  /** Set when an automation with execution overrides started this item. */
  execution?: ExecutionOverrides;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completion?: { by: "merge" | "human"; ref: string };
};

export type RunKind = "work" | "replay" | "benchmark" | "improver" | "planner";

/** Where a run came from. */
export const RUN_SOURCES = [
  "LINEAR",
  "API",
  "MCP",
  "SLACK",
  "TEAMS",
  "DISCORD",
  "LOCAL",
  "SCHEDULED_AGENT",
  "WEB_APP",
  "GITHUB_ACTION",
  "CLI",
  "JIRA",
  "SELF_IMPROVEMENT",
  "GITHUB_WEBHOOK",
  "GITLAB_WEBHOOK",
  "AZURE_DEVOPS_WEBHOOK",
  "AUTOFIX",
  "RUN_SCORER",
  "ORCHESTRATION",
  "BENCHMARK_TRIAL",
  "CREATE_BENCHMARK_TASK",
  "CUSTOM_WEBHOOK",
] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

/** The API-facing run state. `Run.status` keeps Kiln's own, finer values. */
export const RUN_STATES = ["QUEUED", "PENDING", "CLAIMED", "INPROGRESS", "SUCCEEDED", "FAILED", "BLOCKED", "ERROR", "CANCELLED"] as const;
export type RunState = (typeof RUN_STATES)[number];

export type RunError = { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };

export type Run = {
  id: string;
  kind: RunKind;
  factory: string;
  workItemId?: string;
  agent: string;
  agentType: string;
  stage?: string;
  harness: string;
  model?: string;
  definitionSha: string;
  startState: {
    prompt: string;
    instructions: string;
    skills: string[];
    repos: { name: string; url: string; branch?: string; sha: string }[];
    workspaceSha?: string;
  };
  replayOf?: string;
  /** Set when another agent spawned this run as a subagent. */
  parentRunId?: string;
  artifacts: Artifact[];
  traceId: string;
  /**
   * queued: waiting for a self-hosted worker; claimed: a worker took it; running; paused (snapshot);
   * blocked: interrupted, waiting for a follow-up; succeeded; failed: the task could not be done
   * (user-side error); error: the platform failed; cancelled.
   */
  status: "queued" | "claimed" | "running" | "paused" | "blocked" | "succeeded" | "failed" | "error" | "cancelled";
  source?: RunSource;
  title?: string;
  /** Who started it: a person, or `agent:<name>` / `automation:<name>` / `kiln`. */
  creator?: string;
  /** Whose identity the run acts as on the forge (credentialStrategy). */
  executor?: string;
  /** The first run of the tree this run belongs to. */
  rootRunId?: string;
  /** Up to 20 immutable string keys, filterable. */
  metadata?: Record<string, string>;
  mode?: RunMode;
  error?: RunError;
  attempt?: number;
  retryOf?: string;
  /** A follow-up continued this finished run in a new run. */
  continuationOf?: string;
  idleTimeoutMinutes?: number;
  /** Link access for other signed-in people. */
  sharing?: { publicAccess: "VIEWER" | "EDITOR" | null };
  workerHost?: string;
  workerId?: string;
  queuedAt?: string;
  claimedAt?: string;
  summary?: string;
  result?: Record<string, unknown>;
  costUsd: number;
  eventCount: number;
  steering: string[];
  snapshotKey?: string;
  /** The team whose usage this run counts toward. */
  team?: string;
  /** The user who triggered the run, when there is one (their personal secrets apply). */
  userId?: string;
  /** The environment template the run started from. */
  environmentId?: string;
  /** Object key of the run's event transcript (JSON lines), stored per the team's transcript storage. */
  transcriptKey?: string;
  startedAt: string;
  finishedAt?: string;
};

export type RunEvent = { id: string; runId: string; seq: number; at: string; type: string; text?: string; data?: unknown };

export type GateKind = "spec" | "question" | "preview" | "merge" | "custom";

export type Gate = {
  id: string;
  workItemId: string;
  factory: string;
  kind: GateKind;
  name: string;
  title: string;
  question?: string;
  assignees: string[];
  evidence: { label: string; url: string }[];
  state: "open" | "approved" | "rejected" | "answered" | "expired";
  decision?: string;
  answer?: string;
  decidedBy?: string;
  decidedVia?: string;
  openedAt: string;
  decidedAt?: string;
  nudgeEveryMs?: number;
  lastNudgeAt?: string;
  nudges: number;
  expireAt?: string;
  expireAction?: "park" | "reject" | "approve";
  runId?: string;
  command?: string;
  urgency?: number;
  /** Structured questions shown in the inbox: single or multi select, with a recommended option. */
  questions?: GateQuestion[];
};

export type GateQuestion = { id: string; question: string; type: "single_select" | "multi_select"; options: string[]; recommendedOptionIndex?: number };

export type Score = {
  id: string;
  runId: string;
  factory: string;
  agent: string;
  scorer: string;
  label: string;
  score: number;
  passed: boolean;
  rationale?: string;
  judge: string;
  definitionSha: string;
  selfImprovement: boolean;
  reviewed: boolean;
  failureCategory?: string;
  /** automatic after a run finishes, or manual (dispatched by a person). */
  trigger?: "automatic" | "manual";
  costUsd?: number;
  durationMs?: number;
  createdAt: string;
};

export type FactoryBinding = {
  id: string;
  name: string;
  alias: string;
  /** GitHub-backed definitions: a config repo such as fishuke/kiln-config. Absent → Kiln-managed. */
  definitionRepo?: { owner: string; name: string; ref: string; dir: string };
  appliedSha?: string;
  previousSha?: string;
  canary?: { sha: string; percent: number; since: string };
  status: "active" | "invalid" | "paused";
  /** The owning team. Factories created before teams existed move to the default team. */
  team?: string;
  lastError?: string;
  projectId?: string;
  /** Uploaded avatar, served from /api/v1/files/<key>. */
  avatarKey?: string;
  creator?: string;
  /** A move to a GitHub config repo waiting for its pull request to merge. */
  migration?: { owner: string; name: string; ref: string; dir: string; branch: string; prUrl: string };
  createdAt: string;
  updatedAt: string;
};

export type DefinitionRecord = {
  id: string;
  factory: string;
  tree: DefinitionTree;
  author: string;
  createdAt: string;
  valid: boolean;
  errors?: string[];
};

export type Project = { id: string; name: string; owner: string; factories: string[]; roadmapId?: string; createdAt: string; /** The team the project's factories belong to. */ team?: string };

export type RoadmapIssue = { title: string; body: string; criteria: string[]; factory: string; trackerKey?: string; url?: string };
export type Epic = { id: string; title: string; milestone: string; dependsOn: string[]; trackerKey?: string; url?: string; issues: RoadmapIssue[] };
export type Roadmap = { id: string; projectId: string; goal: string; epics: Epic[]; createdAt: string };

export type DecisionLog = {
  id: string;
  decision: string;
  action: string;
  provider: string;
  fellBack: boolean;
  answers: unknown;
  state: unknown;
  workItemId?: string;
  runId?: string;
  latencyMs: number;
  at: string;
};

export type Memory = {
  id: string;
  factory: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  author: string;
  status: "proposed" | "accepted" | "rejected";
  sourceRunId?: string;
  createdAt: string;
};

export type SkillListing = {
  id: string;
  name: string;
  description: string;
  owner: string;
  version: string;
  sourceFactory: string;
  body: string;
  installs: { factory: string; at: string; prUrl?: string }[];
  usage: number;
  publishedAt: string;
  /** The team of the source factory; the catalog is per team. */
  team?: string;
};

export type Proposal = {
  id: string;
  factory: string;
  agent: string;
  category: string;
  target: "definition" | "app";
  failures: { scoreId: string; runId: string; label: string }[];
  changes: Record<string, string>;
  rationale: string;
  replay: { runId: string; before: boolean; after: boolean }[];
  passRateBefore: number;
  passRateAfter: number;
  body: string;
  pr?: { repo: string; number: number; url: string };
  candidateSha?: string;
  needsTwoApprovals: boolean;
  approvals?: string[];
  /** One person picked from the factory's reviewer pool. */
  reviewer?: string;
  droppedProtectedPaths: string[];
  state: "open" | "merged" | "rejected";
  createdAt: string;
};

export type BenchmarkResult = {
  id: string;
  factory: string;
  suite: string;
  configuration: string;
  task: string;
  runId: string;
  success: boolean;
  score: number;
  costUsd: number;
  durationMs: number;
  at: string;
};

export type AuditEntry = { id: string; at: string; actor: string; action: string; target: string; details?: unknown; /** The team it belongs to, when Kiln can tell. */ team?: string };

/** A file someone uploaded; the bytes live in the object store under `key`. */
export type Upload = Attachment & { id: string; uploader: string; factory?: string; createdAt: string };

/** A change to a factory definition proposed by an agent or a person, reviewed in the inbox. */
export type DefinitionChange = {
  id: string;
  factory: string;
  title: string;
  message: string;
  /** path → new content, or null to delete the file. */
  files: Record<string, string | null>;
  diff: { added: string[]; changed: string[]; removed: string[] };
  patches: { path: string; before?: string; after?: string }[];
  proposedBy: string;
  runId?: string;
  workItemId?: string;
  state: "open" | "merged" | "changes_requested" | "rejected";
  comments: { at: string; by: string; path?: string; line?: number; text: string }[];
  result?: { sha?: string; prUrl?: string };
  errors?: string[];
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type BenchmarkConfiguration = {
  name: string;
  /** Per-agent overrides: harness and model, or a router (`router:<slug>`), and the runner. */
  agents: { agent: string; harness?: string; model?: string; runner?: string; authSecretName?: string }[];
  /** Runner for agents that do not name one. */
  runner?: string;
};

export type BenchmarkRun = {
  id: string;
  factory: string;
  suite: string;
  agent: string;
  state: "pending" | "running" | "scoring" | "completed" | "failed" | "cancelled";
  configurations: BenchmarkConfiguration[];
  tasks: string[];
  repetitions: number;
  scorers: string[];
  creator: string;
  cancelRequested?: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type BenchmarkTrial = {
  id: string;
  benchmarkRunId: string;
  factory: string;
  configuration: string;
  task: string;
  repetition: number;
  attempt: number;
  agentRunId?: string;
  state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
  terminalReason?: "timeout" | "failure";
  scoring: { state: "awaiting_trial" | "pending" | "judging" | "scored" | "finished_unscored" | "not_scoreable"; scores: { scorer: string; label: string; score: number; passed: boolean; reason?: string; costUsd: number }[] };
  costUsd: number;
  judgeCostUsd: number;
  durationMs: number;
  startedAt?: string;
  finishedAt?: string;
};

/** Per-person inbox state for an item: read and resolved flags. */
export type InboxState = { id: string; user: string; itemId: string; read: boolean; resolvedAt?: string; updatedAt: string };

/** A connected self-hosted worker process. Several processes may share one `workerId`; runs load-balance across them. */
export type WorkerRecord = {
  id: string;
  workerId: string;
  backend: string;
  version?: string;
  maxConcurrent: number;
  active: string[];
  owner: string;
  connectedAt: string;
  lastHeartbeatAt: string;
  claimed: number;
  completed: number;
};

export const C = {
  workItems: "work_items",
  runs: "runs",
  runEvents: "run_events",
  gates: "gates",
  scores: "scores",
  factories: "factories",
  definitions: "definitions",
  projects: "projects",
  roadmaps: "roadmaps",
  decisions: "decision_logs",
  memories: "memories",
  skills: "skill_listings",
  proposals: "proposals",
  benchmarks: "benchmark_results",
  audit: "audit",
  schedules: "schedules",
  secrets: "secrets",
  uploads: "uploads",
  definitionChanges: "definition_changes",
  benchmarkRuns: "benchmark_runs",
  benchmarkTrials: "benchmark_trials",
  inboxState: "inbox_state",
  workers: "workers",
  scorerMeta: "scorer_meta",
  connections: "connections",
  connectionStates: "connection_oauth_states",
  approvalLinks: "connection_approval_links",
  identityLinks: "identity_links",
  linkTokens: "identity_link_tokens",
  webhookSources: "webhooks",
  webhookDeliveries: "webhook_deliveries",
  eventDeliveries: "event_deliveries",
  deliveriesSeen: "deliveries_seen",
  aliasMaps: "alias_maps",
} as const;
