export const factory = {
  name: "Kiln",
  alias: "kiln",
  product: "Self-improving software factory platform",
  repository: "fishuke/klin",
  schemaVersion: "v1alpha1",
} as const;

export type AgentType = "FOREMAN" | "TRIAGE" | "SPEC" | "IMPLEMENT" | "REVIEW";

export const agents: {
  name: string;
  agentType: AgentType;
  job: string;
  enabled: boolean;
}[] = [
  {
    name: "foreman",
    agentType: "FOREMAN",
    job: "Routes each work item through the stages and talks to people in the thread.",
    enabled: true,
  },
  {
    name: "triage",
    agentType: "TRIAGE",
    job: "Classifies kind and size, checks for duplicates, and routes the item.",
    enabled: true,
  },
  {
    name: "spec",
    agentType: "SPEC",
    job: "Writes the spec and waits for approval before any code is written.",
    enabled: true,
  },
  {
    name: "implement",
    agentType: "IMPLEMENT",
    job: "Builds the change on a kiln/* branch and opens a pull request.",
    enabled: true,
  },
  {
    name: "review",
    agentType: "REVIEW",
    job: "Reviews the pull request. Its verdict is advisory; a human merges.",
    enabled: true,
  },
];

export const workItemStates = [
  "received",
  "triaging",
  "planning",
  "awaiting_spec",
  "building",
  "reviewing",
  "awaiting_preview",
  "handed_off",
  "complete",
] as const;

export const sideStates = ["blocked", "cancelled", "failed"] as const;

export const milestones: {
  id: string;
  title: string;
  weeks: string;
  tasks: number;
}[] = [
  { id: "M0", title: "Repo foundation", weeks: "week 1", tasks: 4 },
  { id: "M1", title: "Definitions as code", weeks: "weeks 2–3", tasks: 6 },
  { id: "M2", title: "Runs, harnesses, sandboxes", weeks: "weeks 4–6", tasks: 8 },
  { id: "M3", title: "Foreman, work items, integrations", weeks: "weeks 7–9", tasks: 8 },
  { id: "M4", title: "Gates, inbox, PO workspace", weeks: "weeks 10–12", tasks: 6 },
  { id: "M5", title: "Measure and improve", weeks: "weeks 13–15", tasks: 7 },
  { id: "M6", title: "Planning and portfolio", weeks: "weeks 16–17", tasks: 5 },
  { id: "M7", title: "Hardening, Kiln MCP, docs, release", weeks: "weeks 18–20", tasks: 5 },
];
