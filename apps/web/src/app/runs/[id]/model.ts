import type { ArtifactGroups, AgentNode, GateView, SubagentRef, TranscriptItem } from "@/lib/run-detail";
import type { PlanView } from "@/lib/run-plan";
import type { RunStatus } from "@/lib/run-tree";

/** Everything the run detail page renders; built on the server, serializable to the client view. */
export type RunDetailModel = {
  id: string;
  isWorkItem: boolean;
  title: string;
  factory: { id: string; name: string };
  agent: string;
  agentLabel: string;
  status: RunStatus;
  live: boolean;
  /** For child runs: the root (work item) they belong to. */
  root?: { id: string; title: string; agent: string; status: RunStatus };
  subagents: SubagentRef[];
  transcript: TranscriptItem[];
  tree: AgentNode[];
  artifacts: ArtifactGroups;
  metadata: {
    env: { label: string; value: string }[];
    runTimeMs: number;
    createdAt: string;
    source: string;
    usage: { label: string; costUsd: number }[];
    totalUsd: number;
    extra: { label: string; value: string; href?: string }[];
  };
  spec?: { criteria: { text: string; status?: string; videoUrl?: string }[]; openQuestions: string[] };
  review?: { verdict: string; findings: string[] };
  triage?: { kind: string; size: string; summary?: string; confidence: number };
  openGates: GateView[];
  /** A task's plan as a checklist with progress; only on work items that have a plan. */
  plan?: PlanView;
  workItem?: { id: string; state: string; blockedReason?: string; branch?: string; prUrl?: string; previewUrl?: string };
  runActions: { canStop: boolean; canPause: boolean; canResume: boolean; canReplay: boolean; canBenchmark: boolean };
  /** Agent run id whose live SSE stream the page follows. */
  streamRunId?: string;
};
