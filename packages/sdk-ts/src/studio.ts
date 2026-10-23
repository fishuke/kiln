/**
 * Studio (ADR-012) as the API serves it. These mirror packages/studio's types; the SDK doesn't depend on
 * that package, and a test in apps/api checks they stay assignable.
 */
export type StudioShipMode = "safe" | "review" | "cowboy";
export type StudioChatMode = "build" | "chat" | "plan";
export type StudioVia = "web" | "mcp" | "api" | "voice";
export type StudioAppSource = { kind: "template"; template: string } | { kind: "repo"; connection?: string; repo: string; branch?: string };

export type StudioAppSetup = {
  mainBranch: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  install: string[];
  dev?: string;
  devDetected?: string;
  devOverride?: string;
  envRequired: string[];
  envMissing: string[];
};

export type StudioApp = {
  id: string;
  team: string;
  projectId?: string;
  name: string;
  source: StudioAppSource;
  setup?: StudioAppSetup;
  shipMode: StudioShipMode;
  harness: string;
  model?: string;
  status: "creating" | "ready" | "paused" | "failed";
  error?: string;
  /** The prompt the App was created with, until its first chat starts. */
  firstPrompt?: { text: string; via: string };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioChat = {
  id: string;
  appId: string;
  title: string;
  mode: StudioChatMode;
  harness: string;
  model?: string;
  branch: string;
  path: string;
  port: number;
  status: "idle" | "working" | "needs_you" | "conflict" | "failed";
  question?: string;
  appliedSha?: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioActivity =
  | { kind: "message" | "reasoning" | "error"; text: string; at: string }
  | { kind: "tool"; name: string; text?: string; at: string }
  | { kind: "subagent"; name: string; text: string; at: string };

export type StudioTurn = {
  id: string;
  appId: string;
  chatId: string;
  prompt: string;
  mode: StudioChatMode;
  via: StudioVia;
  by: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  reply: string;
  title?: string;
  summary?: string;
  question?: string;
  plan?: string;
  checkpoint?: string;
  discarded: boolean;
  resolve?: boolean;
  activity: StudioActivity[];
  /** The turn's latest command approval: decide a `waiting` one with `decide(gateId, "approve" | "reject")`. */
  approval?: { gateId: string; command: string; state: "waiting" | "allowed" | "blocked"; by?: string };
  costUsd: number;
  startedAt: string;
  finishedAt?: string;
  /** The run this turn is, and its trace id in the tracing backend. */
  runId?: string;
  traceId?: string;
};

export type StudioVersion = {
  id: string;
  appId: string;
  sha: string;
  title: string;
  kind: "initial" | "apply" | "restore";
  chatId?: string;
  restoredFrom?: string;
  bookmarked: boolean;
  createdAt: string;
};

/** A failed preview says why (`reason`) and carries the dev server's last output lines. */
export type StudioPreview = { target: string; url: string; status: "starting" | "ready" | "failed"; reason?: string; output?: string };
export type StudioApplyResult = { ok: true; version: StudioVersion } | { ok: false; conflict: string[] } | { ok: false; nothing: true };
export type StudioStatusReport = {
  apps: { id: string; name: string; working: string[]; needsYou: { chatId: string; question: string }[]; latest?: { title: string; at: string } }[];
};
export type StudioClientAction = { focus: { app: string; chat?: string } } | { show: "preview" | "code" | "history" | "hands_free" };
export type StudioToolResult = { ok: true; data: unknown; client?: StudioClientAction } | { ok: false; error: string };

/** Ship mode is not set here: ship's setShipMode changes it after the App policy's cap check. */
/** `prompt` starts the App's first chat once setup is done. */
export type StudioCreateApp = { name: string; projectId?: string; source?: StudioAppSource; harness?: string; model?: string; prompt?: string };
export type StudioUpdateApp = { name?: string; projectId?: string | null; devCommand?: string | null };
export type StudioPullRequestState = "uat" | "ready_for_review" | "waiting_for_review" | "merged" | "cancelled";
/** The App's pull request (docs/specs/studio.md, "Shipping"). */
export type StudioAppPullRequest = {
  id: string;
  appId: string;
  forge: string;
  repo: string;
  number: number;
  url: string;
  branch: string;
  base: string;
  state: StudioPullRequestState;
  versionId: string;
  builtInPreview?: string;
  reviewReasons?: string[];
  previewUrl?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type StudioShip = { title?: string; state?: "uat" | "ready_for_review" | "cancelled" };
export type StudioNewChat = { prompt?: string; mode?: StudioChatMode; harness?: string; model?: string; title?: string };
