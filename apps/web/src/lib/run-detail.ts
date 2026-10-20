/**
 * Run detail model: turns a work item (the root foreman run) or an agent run plus its events into
 * the transcript, agents tree, artifacts and metadata the page renders. Pure and serializable.
 */
import { agentDisplayName, runStatus, runTitle, workItemStatus, type ArtifactLike, type RunLike, type RunStatus } from "./run-tree";

export type AttachmentLike = { key: string; name: string; contentType: string; size: number };
export type EventLike = { seq: number; at: string; type: string; text?: string; data?: unknown };
export type ConversationLike = { at: string; from: string; role: string; text: string; attachments?: AttachmentLike[] };

export type GateView = {
  id: string;
  kind: string;
  title: string;
  question?: string;
  state: string;
  answer?: string;
  decidedBy?: string;
  evidence: { label: string; url: string }[];
  command?: string;
  openedAt: string;
  decidedAt?: string;
  options?: (string | { label: string; recommended?: boolean })[];
  multiSelect?: boolean;
};

export type Step = { kind: "command" | "tool" | "reasoning" | "push" | "error"; label: string; detail?: string; output?: string; isError?: boolean; durationMs?: number };
export type SubagentRef = { id: string; title: string; agent: string; status: RunStatus };

export type TranscriptItem =
  | { type: "user"; key: string; at: string; from: string; text: string; attachments: AttachmentLike[] }
  | { type: "agent"; key: string; at: string; text: string }
  | { type: "reasoning"; key: string; at: string; text: string; durationMs: number }
  | { type: "work"; key: string; at: string; durationMs: number; steps: Step[] }
  | { type: "subagents"; key: string; at: string; runs: SubagentRef[] }
  | { type: "gate"; key: string; at: string; gate: GateView }
  | { type: "system"; key: string; at: string; text: string; tone?: "error" };

export type AgentNode = { id: string; href: string; title: string; agent: string; status: RunStatus; startedAt: string; finishedAt?: string; costUsd: number; children: AgentNode[] };

export type ArtifactView = { kind: "image" | "video" | "file" | "report"; name: string; url: string; runId?: string; caption?: string };
export type ArtifactGroups = {
  prs: { url: string; repo: string; number: number; branch?: string; state: "open" | "merged" | "closed" }[];
  previews: { url: string; label: string }[];
  media: ArtifactView[];
  files: ArtifactView[];
};

/** Public URL for an artifact: stored files go through the web's /files proxy. */
export function artifactUrl(a: { url: string; key?: string }): string {
  if (a.key) return `/files/${a.key}`;
  if (a.url.startsWith("file://")) {
    const m = /\/objects\/(.+)$/.exec(a.url);
    return m ? `/files/${m[1]}` : a.url;
  }
  return a.url;
}

function inputOf(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const input = d.input ?? d;
  return input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
}

function toolStep(e: EventLike): Step {
  const name = e.text ?? "tool";
  const input = inputOf(e.data);
  const command = typeof input?.command === "string" ? input.command : typeof input?.cmd === "string" ? input.cmd : undefined;
  if (command || /^(bash|shell|exec|run_command)$/i.test(name)) return { kind: "command", label: "Ran", detail: command ?? name };
  const arg = input ? (input.file_path ?? input.path ?? input.url ?? input.query ?? input.pattern) : undefined;
  return { kind: "tool", label: `Called ${name}`, detail: typeof arg === "string" ? arg : undefined };
}

const REASONING = new Set(["reasoning", "thinking"]);

/** Groups an agent run's events into transcript items: messages stay, tool work folds into "Worked for". */
export function runTranscript(events: EventLike[], opts: { prompt?: string; promptFrom?: string; startedAt?: string } = {}): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  if (opts.prompt) items.push({ type: "user", key: "prompt", at: opts.startedAt ?? events[0]?.at ?? "", from: opts.promptFrom ?? "Foreman", text: opts.prompt, attachments: [] });
  let work: { key: string; at: string; last: string; steps: Step[] } | undefined;
  const flush = () => {
    if (!work) return;
    items.push({ type: "work", key: work.key, at: work.at, durationMs: Math.max(0, new Date(work.last).getTime() - new Date(work.at).getTime()), steps: work.steps });
    work = undefined;
  };
  const step = (e: EventLike, s: Step) => {
    if (!work) work = { key: `w${e.seq}`, at: e.at, last: e.at, steps: [] };
    work.steps.push(s);
    work.last = e.at;
  };
  for (const e of events) {
    if (e.type === "message") {
      flush();
      if (e.text?.trim()) items.push({ type: "agent", key: `m${e.seq}`, at: e.at, text: e.text });
    } else if (e.type === "tool_call") {
      step(e, toolStep(e));
    } else if (e.type === "tool_result") {
      const last = work?.steps.at(-1);
      const isError = Boolean((e.data as { isError?: boolean } | undefined)?.isError);
      if (last && (last.kind === "command" || last.kind === "tool") && last.output === undefined) {
        last.output = e.text ?? "";
        last.isError = isError;
        work!.last = e.at;
      } else step(e, { kind: "tool", label: "Tool output", output: e.text, isError });
    } else if (REASONING.has(e.type)) {
      const durationMs = Number((e.data as { durationMs?: number } | undefined)?.durationMs ?? 0);
      if (work) step(e, { kind: "reasoning", label: "Reasoned", output: e.text, durationMs });
      else items.push({ type: "reasoning", key: `r${e.seq}`, at: e.at, text: e.text ?? "", durationMs });
    } else if (e.type === "steer") {
      flush();
      items.push({ type: "user", key: `s${e.seq}`, at: e.at, from: (e.data as { by?: string } | undefined)?.by ?? "You", text: e.text ?? "", attachments: [] });
    } else if (e.type === "pushed") {
      step(e, { kind: "push", label: "Pushed", detail: e.text });
    } else if (e.type === "error" || e.type === "guard") {
      flush();
      items.push({ type: "system", key: `e${e.seq}`, at: e.at, text: e.text ?? e.type, tone: e.type === "error" ? "error" : undefined });
    } else if (e.type === "finished") {
      flush();
      if (e.text && e.text !== "succeeded") items.push({ type: "system", key: `f${e.seq}`, at: e.at, text: `Run ${e.text}`, tone: e.text === "failed" ? "error" : undefined });
    }
  }
  flush();
  return items;
}

/** Work item transcript: the foreman conversation, the subagents it launched and its gates, in time order. */
export function workItemTranscript(input: { conversation: ConversationLike[]; runs: RunLike[]; gates: GateView[]; title: string; body?: string; requester: string; createdAt: string; attachments?: AttachmentLike[] }): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const first = input.conversation[0];
  const opening = `${input.title}${input.body ? `\n\n${input.body}` : ""}`;
  // The opening message is the request itself unless the conversation already starts with it.
  if (!first || first.role !== "human" || !first.text.startsWith(input.title)) {
    items.push({ type: "user", key: "request", at: input.createdAt, from: input.requester, text: opening, attachments: input.attachments ?? [] });
  }
  input.conversation.forEach((c, i) => {
    const key = `c${i}`;
    if (c.role === "human") items.push({ type: "user", key, at: c.at, from: c.from, text: c.text, attachments: c.attachments ?? [] });
    else if (c.role === "system") items.push({ type: "system", key, at: c.at, text: c.text });
    else items.push({ type: "agent", key, at: c.at, text: c.text });
  });
  const top = input.runs.filter((r) => !r.parentRunId || !input.runs.some((p) => p.id === r.parentRunId));
  for (const r of top) items.push({ type: "subagents", key: `run-${r.id}`, at: r.startedAt, runs: [{ id: r.id, title: runTitle(r, input.title), agent: r.agent, status: runStatus(r.status) }] });
  for (const g of input.gates) if (g.state !== "open") items.push({ type: "system", key: `g-${g.id}`, at: g.decidedAt ?? g.openedAt, text: gateOutcome(g) });
  items.sort((a, b) => a.at.localeCompare(b.at));
  // Open decisions are what the factory waits on now: they always come last.
  for (const g of input.gates) if (g.state === "open") items.push({ type: "gate", key: `g-${g.id}`, at: g.openedAt, gate: g });
  return mergeSubagents(items);
}

/** Consecutive "Launched 1 subagent" rows fold into one "Launched N subagents". */
function mergeSubagents(items: TranscriptItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const it of items) {
    const prev = out.at(-1);
    if (it.type === "subagents" && prev?.type === "subagents") prev.runs.push(...it.runs);
    else out.push(it.type === "subagents" ? { ...it, runs: [...it.runs] } : it);
  }
  return out;
}

export function gateOutcome(g: Pick<GateView, "kind" | "state" | "decidedBy" | "answer" | "title">): string {
  const by = g.decidedBy ? ` by ${g.decidedBy}` : "";
  if (g.state === "answered") return `Question answered${by}${g.answer ? `: ${g.answer}` : ""}`;
  if (g.state === "expired") return `${g.title} expired`;
  const what = g.kind === "spec" ? "Spec" : g.kind === "preview" ? "Preview" : g.kind === "merge" ? "Merge" : "Request";
  if (g.state === "approved") return `${what} ${g.kind === "preview" ? "accepted" : "approved"}${by}`;
  return `${what} sent back${by}${g.answer ? `: ${g.answer}` : ""}`;
}

export function agentTree(runs: RunLike[], workItemTitle?: string): AgentNode[] {
  const ids = new Set(runs.map((r) => r.id));
  const node = (r: RunLike): AgentNode => ({
    id: r.id,
    href: `/runs/${r.id}`,
    title: runTitle(r, workItemTitle),
    agent: r.agent,
    status: runStatus(r.status),
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    costUsd: r.costUsd,
    children: runs.filter((c) => c.parentRunId === r.id).map(node),
  });
  return runs.filter((r) => !r.parentRunId || !ids.has(r.parentRunId)).map(node);
}

export function workItemNode(wi: { id: string; title: string; state: string; createdAt: string; completedAt?: string; updatedAt: string; costUsd: number }, runs: RunLike[]): AgentNode {
  const status = workItemStatus(wi.state);
  return {
    id: wi.id,
    href: `/runs/${wi.id}`,
    title: wi.title,
    agent: "foreman",
    status,
    startedAt: wi.createdAt,
    finishedAt: status === "running" ? undefined : (wi.completedAt ?? wi.updatedAt),
    costUsd: wi.costUsd,
    children: agentTree(runs, wi.title),
  };
}

export function collectArtifacts(input: { runs: RunLike[]; pr?: { repo: string; number: number; url: string }; branch?: string; prState?: "open" | "merged" | "closed"; previewUrl?: string; evidenceVideos?: { url: string; caption?: string }[] }): ArtifactGroups {
  const out: ArtifactGroups = { prs: [], previews: [], media: [], files: [] };
  if (input.pr) out.prs.push({ ...input.pr, branch: input.branch, state: input.prState ?? "open" });
  if (input.previewUrl) out.previews.push({ url: input.previewUrl, label: "Preview" });
  const seen = new Set<string>();
  const add = (a: ArtifactLike, runId?: string) => {
    const url = artifactUrl(a);
    if (seen.has(url)) return;
    seen.add(url);
    const image = a.kind === "image" || a.contentType?.startsWith("image/");
    const video = a.kind === "video" || a.contentType?.startsWith("video/");
    if (a.kind === "pr") {
      if (!out.prs.some((p) => p.url === a.url)) {
        const m = /([^/]+\/[^/]+)\/(?:pull|merge_requests)\/(\d+)/.exec(a.url);
        out.prs.push({ url: a.url, repo: m?.[1] ?? a.name, number: Number(m?.[2] ?? 0), state: "open" });
      }
    } else if (a.kind === "preview") {
      if (!out.previews.some((p) => p.url === a.url)) out.previews.push({ url: a.url, label: a.name || "Preview" });
    } else if (image || video) out.media.push({ kind: image ? "image" : "video", name: a.name, url, runId, caption: a.name });
    else out.files.push({ kind: a.kind === "report" ? "report" : "file", name: a.name, url, runId });
  };
  for (const r of input.runs) for (const a of r.artifacts ?? []) add(a, r.id);
  for (const v of input.evidenceVideos ?? []) add({ kind: "video", name: v.caption ?? "Video", url: v.url });
  return out;
}

export function agentLabel(agent: string, factoryName?: string): string {
  return agentDisplayName(agent, factoryName);
}
