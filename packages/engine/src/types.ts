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
  provider: "github" | "linear" | "jira" | "slack" | "kiln" | "mcp" | "schedule" | "webhook" | "api";
  url?: string;
  repo?: string;
  number?: number;
  issueId?: string;
  channel?: string;
  thread?: string;
  automation?: string;
};

export type Attachment = { key: string; name: string; contentType: string; size: number };

/** Something a run produced that people look at: screenshots, recordings, reports, the PR, the preview. */
export type Artifact = { kind: "image" | "video" | "file" | "report" | "pr" | "preview"; name: string; url: string; key?: string; contentType?: string; size?: number };

export type ConversationEntry = { at: string; from: string; role: "human" | "foreman" | "agent" | "system"; text: string; attachments?: Attachment[] };

export type WorkItem = {
  id: string;
  factory: string;
  title: string;
  body: string;
  source: Source;
  requester: string;
  state: WorkItemState;
  stage?: string;
  pipeline?: string;
  definitionSha: string;
  triage?: { kind: string; size: string; summary?: string; duplicateOf?: string; confidence: number };
  spec?: { path: string; criteria: string[]; stories: string[]; openQuestions: string[] };
  branch?: string;
  pr?: { repo: string; number: number; url: string };
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
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completion?: { by: "merge" | "human"; ref: string };
};

export type RunKind = "work" | "replay" | "benchmark" | "improver" | "planner";

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
  status: "running" | "succeeded" | "failed" | "cancelled" | "paused";
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
};

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

export type Project = { id: string; name: string; owner: string; factories: string[]; roadmapId?: string; createdAt: string };

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

export type AuditEntry = { id: string; at: string; actor: string; action: string; target: string; details?: unknown };

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
} as const;
