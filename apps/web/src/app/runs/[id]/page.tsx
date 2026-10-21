import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Run, Score, WorkItemDetail } from "@kiln/sdk-ts";
import { api, safe } from "@/lib/kiln";
import { agentLabel, agentTree, collectArtifacts, runTranscript, workItemNode, workItemTranscript, type GateView } from "@/lib/run-detail";
import { planView, type PlanLike } from "@/lib/run-plan";
import { runSource, runStatus, runTitle, workItemStatus } from "@/lib/run-tree";
import type { RunDetailModel } from "./model";
import { RunDetailView } from "./run-detail-view";

type RunWithLive = Run & { live: boolean; scores: Score[]; title?: string; source?: string; createdBy?: string };

async function load(id: string) {
  const wi = id.startsWith("wi_") ? await safe(() => api.workItem(id), null) : null;
  if (wi) return { wi, run: null as RunWithLive | null };
  const run = (await safe(() => api.run(id), null)) as RunWithLive | null;
  if (!run) {
    // Old links may use work item ids without the prefix check.
    const maybe = await safe(() => api.workItem(id), null);
    return maybe ? { wi: maybe, run: null } : null;
  }
  const parent = run.workItemId ? await safe(() => api.workItem(run.workItemId!), null) : null;
  return { wi: parent, run };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await load(id);
  if (!d) return { title: "Run" };
  return { title: d.run ? runTitle(d.run, d.wi?.title) : d.wi!.title };
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();
  const factories = await safe(() => api.factories(), []);
  const model = d.run ? await runModel(d.run, d.wi, factories) : await workItemModel(d.wi!, factories);
  return <RunDetailView model={model} />;
}

function gateView(g: WorkItemDetail["gates"][number]): GateView {
  const x = g as typeof g & { options?: GateView["options"]; multiSelect?: boolean };
  return { id: g.id, kind: g.kind, title: g.title, question: g.question, state: g.state, answer: g.answer, decidedBy: g.decidedBy, evidence: g.evidence, command: g.command, openedAt: g.openedAt, decidedAt: g.decidedAt, options: x.options, multiSelect: x.multiSelect };
}

function durationMs(start: string, end?: string) {
  return Math.max(0, (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime());
}

const factoryName = (factories: { id: string; name: string }[], id: string) => factories.find((f) => f.id === id)?.name ?? id;

function evidenceVideos(wi: WorkItemDetail) {
  const crit = wi.evidence?.criteria ?? {};
  return Object.entries(crit)
    .filter(([, v]) => v.videoUrl)
    .map(([k, v]) => ({ url: v.videoUrl!, caption: `${k}: ${v.test ?? v.status}` }));
}

function specView(wi: WorkItemDetail): RunDetailModel["spec"] {
  if (!wi.spec) return undefined;
  return {
    criteria: wi.spec.criteria.map((c) => {
      const key = /^(AC\d+)/.exec(c)?.[1] ?? c;
      const ev = wi.evidence?.criteria[key];
      return { text: c, status: ev?.status, videoUrl: ev?.videoUrl };
    }),
    openQuestions: wi.spec.openQuestions,
  };
}

async function workItemModel(wi: WorkItemDetail, factories: { id: string; name: string }[]): Promise<RunDetailModel> {
  const status = workItemStatus(wi.state);
  const gates = wi.gates.map(gateView);
  const runs = wi.runs;
  const root = workItemNode(wi, runs);
  const liveRun = runs.find((r) => r.status === "running");
  // What running subagents are doing right now, shown under their rows.
  const running = runs.filter((r) => r.status === "running");
  const activity = Object.fromEntries(await Promise.all(running.map(async (r) => [r.id, runTranscript(await safe(() => api.runEvents(r.id), []))] as const)));
  const fname = factoryName(factories, wi.factory);
  // The API returns the engine's plan on the work item; the SDK type does not name it.
  const plan = planView({ state: wi.state, plan: (wi as { plan?: PlanLike }).plan, blockedReason: wi.blockedReason, runs, openGates: gates.filter((g) => g.state === "open") });
  const usage = [{ label: `Foreman · ${wi.title}`, costUsd: Math.max(0, wi.costUsd - runs.reduce((n, r) => n + r.costUsd, 0)) }, ...runs.map((r) => ({ label: `${cap(r.agent)} · ${runTitle(r, wi.title)}`, costUsd: r.costUsd }))].filter((u, i) => i > 0 || u.costUsd > 0);
  return {
    id: wi.id,
    isWorkItem: true,
    title: wi.title,
    factory: { id: wi.factory, name: fname },
    agent: "foreman",
    agentLabel: agentLabel("foreman", fname),
    status,
    live: status === "running" || Boolean(liveRun),
    subagents: root.children.map((c) => ({ id: c.id, title: c.title, agent: c.agent, status: c.status })),
    transcript: workItemTranscript({ conversation: wi.conversation, runs, gates, title: wi.title, body: wi.body, requester: wi.requester, createdAt: wi.createdAt, attachments: wi.attachments, activity, plan }),
    tree: [root],
    artifacts: collectArtifacts({ runs, pr: wi.pr, branch: wi.branch, prState: wi.completion?.by === "merge" ? "merged" : wi.state === "cancelled" ? "closed" : "open", previewUrl: wi.previewUrl, evidenceVideos: evidenceVideos(wi) }),
    metadata: {
      env: [
        { label: "Factory", value: `${fname} (${wi.factory})` },
        { label: "Definition", value: wi.definitionSha.slice(0, 12) },
        ...(wi.pipeline ? [{ label: "Pipeline", value: wi.pipeline }] : []),
      ],
      runTimeMs: durationMs(wi.createdAt, status === "running" ? undefined : (wi.completedAt ?? wi.updatedAt)),
      createdAt: wi.createdAt,
      source: wi.source.provider,
      usage,
      totalUsd: wi.costUsd,
      extra: [
        { label: "Requested by", value: wi.requester },
        { label: "State", value: wi.state.replace(/_/g, " ") },
        ...(wi.budgetUsd ? [{ label: "Budget", value: `$${wi.budgetUsd.toFixed(2)}` }] : []),
        ...(wi.branch ? [{ label: "Branch", value: wi.branch }] : []),
        ...(wi.source.url ? [{ label: "Origin", value: wi.source.url, href: wi.source.url }] : []),
        ...(wi.blockedReason ? [{ label: "Blocked", value: wi.blockedReason }] : []),
        { label: "Human touches", value: String(wi.humanTouches) },
      ],
    },
    spec: specView(wi),
    review: wi.review,
    triage: wi.triage,
    openGates: gates.filter((g) => g.state === "open"),
    plan,
    workItem: { id: wi.id, state: wi.state, blockedReason: wi.blockedReason, branch: wi.branch, prUrl: wi.pr?.url, previewUrl: wi.previewUrl },
    runActions: { canStop: !["complete", "cancelled", "failed"].includes(wi.state), canPause: false, canResume: false, canReplay: false, canBenchmark: false },
    streamRunId: liveRun?.id,
  };
}

async function runModel(run: RunWithLive, wi: WorkItemDetail | null, factories: { id: string; name: string }[]): Promise<RunDetailModel> {
  const events = await safe(() => api.runEvents(run.id), []);
  const siblings = wi?.runs ?? (await safe(() => api.runs({ factory: run.factory, limit: 500 }), [])).filter((r) => r.parentRunId === run.id || r.id === run.id);
  const subtree = collectSubtree(siblings, run.id);
  const fname = factoryName(factories, run.factory);
  const status = runStatus(run.status);
  const tree = agentTree(subtree, wi?.title);
  const children = tree[0]?.children ?? [];
  const scoreLines = run.scores.map((s) => ({ label: `Score · ${s.scorer}`, value: `${s.label} (${s.score})${s.passed ? "" : " · failed"}` }));
  return {
    id: run.id,
    isWorkItem: false,
    title: runTitle(run, wi?.title),
    factory: { id: run.factory, name: fname },
    agent: run.agent,
    agentLabel: agentLabel(run.agent, fname),
    status,
    live: run.live || run.status === "running",
    root: wi ? { id: wi.id, title: wi.title, agent: "foreman", status: workItemStatus(wi.state) } : undefined,
    subagents: children.map((c) => ({ id: c.id, title: c.title, agent: c.agent, status: c.status })),
    transcript: runTranscript(events, { prompt: run.startState.prompt, promptFrom: wi ? "Foreman" : (run.createdBy ?? "Kiln"), startedAt: run.startedAt }),
    tree,
    artifacts: collectArtifacts({ runs: subtree }),
    metadata: {
      env: [
        { label: "Harness", value: `${run.harness}${run.model ? ` · ${run.model}` : ""}` },
        { label: "Definition", value: run.definitionSha.slice(0, 12) },
        ...run.startState.repos.map((r) => ({ label: "Repo", value: `${r.name} @ ${r.sha.slice(0, 10)}${r.branch ? ` (${r.branch})` : ""}` })),
      ],
      runTimeMs: durationMs(run.startedAt, run.finishedAt),
      createdAt: run.startedAt,
      source: runSource(run),
      usage: subtree.map((r) => ({ label: `${cap(r.agent)} · ${runTitle(r, wi?.title)}`, costUsd: r.costUsd })),
      totalUsd: subtree.reduce((n, r) => n + r.costUsd, 0),
      extra: [
        { label: "Trace", value: run.traceId },
        ...(run.stage ? [{ label: "Stage", value: run.stage }] : []),
        ...(run.replayOf ? [{ label: "Replay of", value: run.replayOf, href: `/runs/${run.replayOf}` }] : []),
        ...(run.summary ? [{ label: "Summary", value: run.summary }] : []),
        ...scoreLines,
      ],
    },
    openGates: (wi?.gates ?? []).filter((g) => g.state === "open" && g.runId === run.id).map(gateView),
    workItem: wi ? { id: wi.id, state: wi.state, blockedReason: wi.blockedReason, branch: wi.branch, prUrl: wi.pr?.url, previewUrl: wi.previewUrl } : undefined,
    runActions: { canStop: run.live || run.status === "running", canPause: run.status === "running", canResume: run.status === "paused", canReplay: !run.live, canBenchmark: !run.live },
    streamRunId: run.live || run.status === "running" ? run.id : undefined,
  };
}

function collectSubtree(runs: Run[], rootId: string): Run[] {
  const out: Run[] = [];
  const visit = (id: string) => {
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    out.push(r);
    for (const c of runs.filter((x) => x.parentRunId === id)) visit(c.id);
  };
  visit(rootId);
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
