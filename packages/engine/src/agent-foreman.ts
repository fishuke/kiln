/**
 * The agent foreman's contract. Each foreman turn is one FOREMAN agent run: it reads a digest of
 * the task and the events since its last turn, and answers with actions in `.kiln/result.json`.
 * Kiln carries the actions out durably and wakes the foreman on the next event, so the foreman
 * holds no session and costs nothing while it waits.
 */
import { z } from "zod";
import type { ForemanEvent, Gate, Run, WorkItem } from "./types";

export const ForemanActions = z.object({
  /** Messages to the requester, in the foreman's own voice. */
  say: z.union([z.string(), z.array(z.string())]).optional(),
  /** The whole checklist; replaces the previous one. */
  tasks: z.array(z.object({ title: z.string().min(1), status: z.enum(["todo", "active", "done", "blocked"]).default("todo") })).optional(),
  /** Start agents; they run in parallel. `title` is the short line people see for the run. */
  dispatch: z.array(z.object({ agent: z.string().min(1), brief: z.string().min(1), stage: z.string().optional(), title: z.string().optional() })).max(10).optional(),
  /** Send more work to an agent that already has the context. */
  followUp: z.array(z.object({ runId: z.string().min(1), message: z.string().min(1) })).max(10).optional(),
  ask: z.object({ question: z.string().min(1), options: z.array(z.string()).optional() }).optional(),
  /** Ask the requester to approve the spec the spec agent wrote. */
  approveSpec: z.boolean().optional(),
  /** Wake again when CI on the pull request finishes. */
  waitForCi: z.boolean().optional(),
  /** The pull request is ready: give it to a person to merge, with what changed and where to look. */
  handOff: z.union([z.boolean(), z.object({ summary: z.string().min(1) })]).optional(),
  /** Done without code changes: the summary goes to the requester, who confirms. */
  finish: z.string().optional(),
});
export type ForemanActions = z.infer<typeof ForemanActions>;

export function parseActions(result: unknown): { ok: true; actions: ForemanActions } | { ok: false; error: string } {
  const parsed = ForemanActions.safeParse(result ?? {});
  if (parsed.success) return { ok: true, actions: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "result"}: ${i.message}`).join("; ") };
}

/** Whether the actions move the work: anything besides talking and updating the checklist. */
export function movesWork(a: ForemanActions): boolean {
  return Boolean(a.dispatch?.length || a.followUp?.length || a.ask || a.approveSpec || a.waitForCi || a.handOff || a.finish !== undefined);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const FOREMAN_ACTIONS_HELP = `## Answer with actions
Write \`.kiln/result.json\` with any of these keys, then stop. Kiln carries them out and wakes you with the next event (an agent finishing, a person's message or decision, CI). You never need to wait or poll.
- \`say\`: a short message to the requester, in your own voice ("I'm looking into it", not "I dispatched triage"). Acknowledge new work on your first turn. Skip it when there is nothing a person needs to hear.
- \`tasks\`: your whole checklist, [{"title": "...", "status": "todo|active|done|blocked"}]. Write it on your first turn and keep it current.
- \`dispatch\`: start agents, [{"agent": "<name>", "title": "<short line people see>", "brief": "<everything the agent needs>", "stage": "triage|spec|build|review|..."}]. Several run in parallel.
- \`followUp\`: more work for an agent that already has the context, [{"runId": "...", "message": "..."}] (answers to its questions, review findings, CI failures).
- \`ask\`: {"question": "...", "options": ["..."]} when only a person can decide.
- \`approveSpec\`: true once the spec agent finished, to ask the requester to approve the spec.
- \`waitForCi\`: true to wake when CI on the pull request finishes.
- \`handOff\`: {"summary": "..."} when the pull request is ready for a person to merge: what changed, how it was verified, and what the reviewer should focus on. It is what the reviewer reads first in their inbox. Kiln opens and updates pull requests; you never merge.
- \`finish\`: "<summary>" when the work needs no code change (an answer, an investigation).
Every turn must move the work (dispatch, followUp, ask, approveSpec, waitForCi, handOff or finish) unless agents are still running or a person was asked.`;

export function foremanPrompt(input: {
  wi: WorkItem;
  runs: Run[];
  gates: Gate[];
  events: ForemanEvent[];
  agents: { name: string; agentType: string; description?: string }[];
  ci?: string;
}): string {
  const { wi } = input;
  const lines = [`# ${wi.title}`, "", wi.body || "(no description)", "", `Requested by ${wi.requester} via ${wi.source.provider}${wi.source.url ? ` (${wi.source.url})` : ""}.`];
  if (wi.tasks?.length) lines.push("", "## Your checklist", ...wi.tasks.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.status === "active" || t.status === "blocked" ? ` (${t.status})` : ""}`));
  const talk = wi.conversation.filter((c) => c.role === "human" || c.role === "foreman").slice(-20);
  if (talk.length) lines.push("", "## Conversation", ...talk.map((c) => `- ${c.role === "foreman" ? "you" : c.from}: ${clip(c.text, 600)}`));
  if (input.runs.length) {
    lines.push("", "## Agent runs");
    for (const r of input.runs) {
      const extra = r.result ? ` · result: ${clip(JSON.stringify(r.result), 800)}` : "";
      lines.push(`- ${r.id} · ${r.agent}${r.stage ? ` (${r.stage})` : ""} · ${r.status}${r.summary ? ` · ${clip(r.summary, 400)}` : ""}${extra}`);
    }
  }
  if (wi.triage) lines.push("", `Triage: ${wi.triage.kind}, size ${wi.triage.size}. ${wi.triage.summary ?? ""}`.trim());
  if (wi.spec) lines.push("", `Spec: ${wi.spec.path}`, ...wi.spec.criteria.map((c) => `- ${c}`));
  if (wi.pr) lines.push("", `Pull request: ${wi.pr.url}${input.ci ? ` · CI ${input.ci}` : ""}`);
  if (wi.review) lines.push("", `Review: ${wi.review.verdict}`, ...wi.review.findings.map((f) => `- ${f}`));
  const decided = input.gates.filter((g) => g.state !== "open" && g.kind !== "merge");
  if (decided.length) lines.push("", "## Decisions by people", ...decided.map((g) => `- ${g.kind} "${g.title}": ${g.state}${g.decidedBy ? ` by ${g.decidedBy}` : ""}${g.answer ? `: ${clip(g.answer, 400)}` : ""}`));
  const open = input.gates.filter((g) => g.state === "open");
  if (open.length) lines.push("", "## Waiting on people", ...open.map((g) => `- ${g.kind}: ${g.title}`));
  lines.push("", "## Agents you can dispatch", ...input.agents.map((a) => `- ${a.name} (${a.agentType})${a.description ? `: ${a.description}` : ""}`));
  lines.push("", "## Events since your last turn", ...input.events.map((e) => `- ${e.type}: ${clip(e.text, 1500)}`));
  lines.push("", FOREMAN_ACTIONS_HELP);
  return lines.join("\n");
}
