import { DeliveryDedupe, type IncomingEvent } from "@kiln/integrations";
import type { Trigger } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { C, type WorkItem } from "./types";

const DESCRIPTORS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function field(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let [lo, hi] = [min, max];
    if (range !== "*") {
      const [a, b] = range!.split("-").map(Number);
      lo = a!;
      hi = b ?? (stepS ? max : a!);
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < min || hi > max || step < 1) throw new Error(`bad cron field ${spec}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Five-field cron (UTC) or a descriptor such as @daily. */
export function parseCron(expr: string) {
  const parts = (DESCRIPTORS[expr.trim()] ?? expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron needs 5 fields: ${expr}`);
  const [mi, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const sets = { mi: field(mi, 0, 59), h: field(h, 0, 23), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow.replace("7", "0"), 0, 6) };
  const domStar = dom === "*";
  const dowStar = dow === "*";
  return {
    matches(d: Date) {
      const dayOk = domStar && dowStar ? true : domStar ? sets.dow.has(d.getUTCDay()) : dowStar ? sets.dom.has(d.getUTCDate()) : sets.dom.has(d.getUTCDate()) || sets.dow.has(d.getUTCDay());
      return sets.mi.has(d.getUTCMinutes()) && sets.h.has(d.getUTCHours()) && sets.mon.has(d.getUTCMonth() + 1) && dayOk;
    },
    /** First matching minute strictly after `after`. */
    next(after: Date): Date {
      const d = new Date(after);
      d.setUTCSeconds(0, 0);
      for (let i = 0; i < 366 * 24 * 60; i++) {
        d.setUTCMinutes(d.getUTCMinutes() + 1);
        if (this.matches(d)) return new Date(d);
      }
      throw new Error(`cron ${expr} never fires`);
    },
  };
}

type FilterValue = unknown;

function asList(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

/** Filter semantics: each key must intersect; `not_in` excludes; `in` is the explicit form. */
export function filterMatches(filter: Record<string, FilterValue> | undefined, data: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (key === "not_in" || key === "in") {
      for (const [k, v] of Object.entries((expected ?? {}) as Record<string, unknown>)) {
        const have = asList(data[k]).map((x) => String(x).toLowerCase());
        const hit = asList(v).some((x) => have.includes(String(x).toLowerCase()));
        if (key === "not_in" ? hit : !hit) return false;
      }
      continue;
    }
    if (key === "webhook") continue;
    const want = asList(expected).map((x) => String(x).toLowerCase());
    const have = asList(data[key]).map((x) => String(x).toLowerCase());
    if (want.length && !want.some((w) => have.includes(w))) return false;
  }
  return true;
}

export class AutomationService {
  private readonly dedupe = new DeliveryDedupe();

  constructor(private readonly k: Kiln) {}

  /**
   * Route a provider event: continue existing work it belongs to, then start new work for every
   * automation whose trigger matches.
   */
  async handle(event: IncomingEvent): Promise<{ started: WorkItem[]; continued: string[]; duplicate: boolean }> {
    if (!this.dedupe.firstTime(event.deliveryId ? `${event.provider}:${event.deliveryId}` : undefined)) return { started: [], continued: [], duplicate: true };
    // A merge to a factory's config repo (e.g. fishuke/kiln-config) applies the new definition.
    if (event.provider === "github" && event.event === "push") {
      const synced: string[] = [];
      for (const f of this.k.defs.list()) {
        const r = f.definitionRepo;
        if (r && `${r.owner}/${r.name}` === event.data.repo && event.data.head === r.ref) {
          await this.k.defs.syncFromRepo(f.id, `push:${String(event.data.sha ?? "").slice(0, 7)}`);
          synced.push(f.id);
        }
      }
      if (synced.length) return { started: [], continued: synced, duplicate: false };
    }
    const continued = await this.continueExisting(event);
    const started: WorkItem[] = [];
    if (continued.length === 0) {
      for (const f of this.k.defs.list()) {
        if (f.status !== "active" || !f.appliedSha) continue;
        const resolved = this.k.defs.resolved(f.appliedSha);
        for (const a of Object.values(resolved.automations)) {
          if (!a.enabled) continue;
          const trigger = a.triggers.find((t) => this.triggerMatches(t, event, f.alias));
          if (!trigger) continue;
          started.push(await this.start(f.id, a.name, a.agent, a.prompt, event, resolved.agents[a.agent]?.agentType === "FOREMAN"));
        }
        if (!started.some((w) => w.factory === f.id) && this.mentionsFactory(event, f.alias) && !Object.keys(resolved.automations).length) {
          started.push(await this.start(f.id, "mention", Object.values(resolved.agents).find((x) => x.agentType === "FOREMAN")!.name, "", event, true));
        }
      }
    }
    return { started, continued, duplicate: false };
  }

  private mentionsFactory(event: IncomingEvent, alias: string) {
    return (event.data.mentioned ?? []).includes(alias.toLowerCase()) && ["app_mention", "issue_mentioned", "pull_request_mentioned", "direct_message"].includes(event.event);
  }

  triggerMatches(t: Trigger, event: IncomingEvent, alias: string): boolean {
    if (t.provider !== event.provider || t.event !== event.event) return false;
    if (event.provider === "slack" && event.event === "app_mention" && !t.filter?.mentioned) {
      // A Slack mention reaches the factory it names (or any factory when the bot is mentioned bare).
      const m = event.data.mentioned ?? [];
      if (m.length && !m.includes(alias.toLowerCase())) return false;
    }
    if (t.provider === "webhook") return (t.filter as { webhook?: string } | undefined)?.webhook === event.data.webhook;
    return filterMatches(t.filter as Record<string, unknown> | undefined, event.data as Record<string, unknown>);
  }

  private async start(factory: string, automation: string, agent: string, prompt: string, event: IncomingEvent, viaForeman: boolean) {
    const d = event.data;
    const title = String(d.title ?? d.text ?? `${event.provider} ${event.event}`).replace(/<@[^>]+>\s*/g, "").split("\n")[0]!.slice(0, 120) || `${event.event}`;
    const wi = await this.k.workflow.create({
      factory,
      title,
      body: [d.body ?? (d.title ? d.text : String(d.text ?? "").split("\n").slice(1).join("\n")) ?? "", prompt ? `\n---\nAutomation "${automation}": ${prompt}` : ""].join("").trim(),
      source: {
        provider: event.provider === "factory" ? "kiln" : (event.provider as WorkItem["source"]["provider"]),
        url: d.url as string | undefined,
        repo: d.repo,
        number: d.number,
        issueId: d.issueId,
        channel: d.channel,
        thread: d.thread,
        automation,
      },
      requester: String(d.author ?? event.provider),
      trackerKey: event.provider === "linear" || event.provider === "jira" ? d.issueId : undefined,
      directAgent: viaForeman ? undefined : agent,
      prompt,
    });
    void this.k.workflow.advance(wi.id);
    return wi;
  }

  /** Factory-internal events (stage changes) only reach automations of the same factory. */
  async handleFactoryEvent(factory: string, event: IncomingEvent): Promise<WorkItem[]> {
    const f = this.k.defs.get(factory);
    if (!f?.appliedSha) return [];
    const resolved = this.k.defs.resolved(f.appliedSha);
    const started: WorkItem[] = [];
    for (const a of Object.values(resolved.automations)) {
      if (!a.enabled || !a.triggers.some((t) => this.triggerMatches(t, event, f.alias))) continue;
      started.push(await this.start(factory, `stage:${a.name}`, a.agent, a.prompt, event, resolved.agents[a.agent]?.agentType === "FOREMAN"));
    }
    return started;
  }

  /** Thread replies, comments and merges that belong to work already in flight. */
  private async continueExisting(event: IncomingEvent): Promise<string[]> {
    const d = event.data;
    const items = this.k.workflow.list();
    if (event.provider === "github" && event.event === "pull_request_merged" && d.repo && d.number) {
      const wi = await this.k.workflow.onPullRequestMerged(d.repo, d.number, d.mergedBy as string | undefined);
      return wi ? [wi.id] : [];
    }
    if (event.provider === "github" && event.event === "pull_request_review_submitted" && d.repo && d.number && d.state !== "approved") {
      const wi = items.find((w) => w.pr !== undefined && w.pr.repo === d.repo && w.pr.number === d.number);
      if (wi) {
        await this.k.workflow.onReviewSubmitted(d.repo, d.number, String(d.text ?? "changes requested"), String(d.author ?? "reviewer"));
        return [wi.id];
      }
    }
    const match = items.find(
      (w) =>
        (d.thread && w.source.channel === d.channel && w.source.thread === d.thread) ||
        (d.issueId && (w.source.issueId === d.issueId || w.trackerKey === d.issueId)) ||
        (d.repo && d.number && ((w.source.repo === d.repo && w.source.number === d.number) || (w.pr !== undefined && w.pr.repo === d.repo && w.pr.number === d.number))),
    );
    if (!match || ["issue_labeled", "pull_request_labeled"].includes(event.event)) return [];
    if (["complete", "cancelled", "failed"].includes(match.state)) return [];
    const text = String(d.text ?? "").replace(/<@[^>]+>\s*/g, "").trim();
    if (!text) return [match.id];
    const author = String(d.author ?? event.provider);
    const open = this.k.gates.list({ workItemId: match.id, state: "open" });
    const question = open.find((g) => g.kind === "question" && !g.command);
    const approval = open.find((g) => g.kind === "spec" || g.kind === "preview");
    if (approval && /^(approve|approved|lgtm|ship it|accept)\b/i.test(text)) {
      await this.k.gates.decide(approval.id, { decision: "approve", by: author, via: event.provider });
    } else if (approval && /^(reject|changes?:|request changes)/i.test(text)) {
      await this.k.gates.decide(approval.id, { decision: "reject", answer: text.replace(/^(reject|changes?:|request changes)\s*/i, ""), by: author, via: event.provider });
    } else if (question) {
      await this.k.gates.decide(question.id, { decision: "answer", answer: text, by: author, via: event.provider });
    } else {
      const live = this.k.runs.list({ workItemId: match.id }).find((r) => this.k.runs.isActive(r.id));
      if (live) await this.k.runs.steer(live.id, text, author);
      else this.k.workflow.addMessage(match.id, author, text);
    }
    return [match.id];
  }

  /** Fire due schedule triggers. Each schedule keeps its last fire time in the store. */
  async tick() {
    const now = this.k.clock.now();
    for (const f of this.k.defs.list()) {
      if (f.status !== "active" || !f.appliedSha) continue;
      const resolved = this.k.defs.resolved(f.appliedSha);
      for (const a of Object.values(resolved.automations)) {
        if (!a.enabled) continue;
        for (const [i, t] of a.triggers.entries()) {
          if (t.provider !== "schedule" || !t.schedule) continue;
          const id = `${f.id}/${a.name}/${t.schedule.name ?? i}`;
          const state = this.k.store.get<{ id: string; lastFired?: string; createdAt: string }>(C.schedules, id) ?? { id, createdAt: now.toISOString() };
          const cron = parseCron(t.schedule.cron);
          const due = cron.next(new Date(state.lastFired ?? state.createdAt));
          if (!state.lastFired && !this.k.store.get(C.schedules, id)) this.k.store.put(C.schedules, state);
          if (due <= now) {
            this.k.store.put(C.schedules, { ...state, lastFired: now.toISOString() });
            await this.start(f.id, a.name, a.agent, a.prompt, { provider: "schedule", event: "cron_fired", data: { title: `${a.name} (${t.schedule.name ?? t.schedule.cron})`, author: "schedule" } }, resolved.agents[a.agent]?.agentType === "FOREMAN");
          }
        }
      }
    }
  }
}
