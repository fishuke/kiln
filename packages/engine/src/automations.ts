import { webhookIdOf, type ResolvedAutomation, type ResolvedFactory } from "@kiln/definitions";
import type { IncomingEvent } from "@kiln/integrations";
import { ALIAS_KEYS, parseCron, type IntegrationSettings, type Trigger } from "@kiln/schema";
import type { Kiln } from "./kiln";
import { evaluateTrigger, STAGE_OF_STATE, type AliasMap, type CheckOutcome } from "./matchers";
import { C, newId, type Attachment, type ExecutionOverrides, type WorkItem } from "./types";

export { parseCron } from "@kiln/schema";

/** A provider delivery as received, kept so "Test filter" can replay it against an automation. */
export type EventDelivery = {
  id: string;
  provider: IncomingEvent["provider"];
  deliveryId?: string;
  events: { event: string; data: IncomingEvent["data"] }[];
  receivedAt: string;
  started: string[];
  continued: string[];
  duplicate: boolean;
};

export type HandleResult = { started: WorkItem[]; continued: string[]; duplicate: boolean; matched: { factory: string; automation: string; event: string }[]; deliveryRecord?: string };

/** Chat providers whose plain thread replies follow `autoRespondToThreadReplies`. */
const CHAT_SETTINGS: Record<string, "slack" | "microsoft-teams" | "discord"> = { slack: "slack", teams: "microsoft-teams", discord: "discord" };
const INTEGRATION_OF: Record<string, IntegrationSettings["type"]> = { slack: "slack", teams: "microsoft-teams", discord: "discord", linear: "linear", jira: "jira" };
const MENTION_EVENTS = ["app_mention", "issue_mentioned", "pull_request_mentioned", "message_dm", "slash_command", "bot_mentioned", "agent_session_created", "work_item_mentioned"];
const DELIVERY_RETENTION_MS = 7 * 86_400_000;
const DELIVERY_KEEP_AT_LEAST = 200;

/** Kept for callers of the older API: an `in`/`not_in`/bare-list filter over event data. */
export function filterMatches(filter: Record<string, unknown> | undefined, data: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    const have = (Array.isArray(data[key]) ? (data[key] as unknown[]) : data[key] === undefined ? [] : [data[key]]).map((x) => String(x).toLowerCase());
    const sets: { in?: unknown[]; not_in?: unknown[] } = Array.isArray(expected) ? { in: expected } : typeof expected === "object" && expected ? (expected as { in?: unknown[]; not_in?: unknown[] }) : { in: [expected] };
    if (sets.in?.length && !sets.in.some((w) => have.includes(String(w).toLowerCase()))) return false;
    if (sets.not_in?.some((w) => have.includes(String(w).toLowerCase()))) return false;
  }
  return true;
}

export class AutomationService {
  constructor(private readonly k: Kiln) {}

  // ---------------------------------------------------------------------------------------------
  // Delivery log and dedupe

  private seen(key: string): boolean {
    return Boolean(this.k.store.get(C.deliveriesSeen, key));
  }

  private markSeen(key: string) {
    this.k.store.put(C.deliveriesSeen, { id: key, at: this.k.clock.now().toISOString() });
  }

  /** Recent provider deliveries (newest first), for "Test filter" pickers. */
  deliveries(filter: { provider?: string; limit?: number } = {}): EventDelivery[] {
    return this.k.store
      .list<EventDelivery>(C.eventDeliveries, (d) => !filter.provider || d.provider === filter.provider)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, filter.limit ?? 100);
  }

  delivery(id: string): EventDelivery | undefined {
    return this.k.store.get<EventDelivery>(C.eventDeliveries, id) ?? this.k.store.list<EventDelivery>(C.eventDeliveries, (d) => d.deliveryId === id)[0];
  }

  /** Keep at least the last 200 deliveries and everything from the last 7 days. */
  pruneDeliveries() {
    const cutoff = new Date(this.k.clock.now().getTime() - DELIVERY_RETENTION_MS).toISOString();
    const all = this.deliveries({ limit: Number.MAX_SAFE_INTEGER });
    for (const d of all.slice(DELIVERY_KEEP_AT_LEAST)) if (d.receivedAt < cutoff) this.k.store.delete(C.eventDeliveries, d.id);
    for (const s of this.k.store.list<{ id: string; at: string }>(C.deliveriesSeen)) if (s.at < cutoff) this.k.store.delete(C.deliveriesSeen, s.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Routing

  /**
   * Route one delivery (one or more events from the same provider call): continue work it belongs
   * to, otherwise start new work for every automation with a matching trigger. Each automation
   * fires at most once per delivery even when several of its triggers match.
   */
  async handle(input: IncomingEvent | IncomingEvent[], opts: { attachments?: Attachment[]; envelope?: string } = {}): Promise<HandleResult> {
    const events = (Array.isArray(input) ? input : [input]).filter(Boolean);
    const first = events[0];
    if (!first) return { started: [], continued: [], duplicate: false, matched: [] };
    const key = first.deliveryId ? `${first.provider}:${first.deliveryId}` : undefined;
    const record: EventDelivery = {
      id: newId("dlv"),
      provider: first.provider,
      deliveryId: first.deliveryId,
      events: events.map((e) => ({ event: e.event, data: e.data })),
      receivedAt: this.k.clock.now().toISOString(),
      started: [],
      continued: [],
      duplicate: false,
    };
    if (key && this.seen(key)) {
      this.k.store.put(C.eventDeliveries, { ...record, duplicate: true });
      return { started: [], continued: [], duplicate: true, matched: [], deliveryRecord: record.id };
    }
    if (key) this.markSeen(key);

    const result = await this.route(events, opts);
    this.k.store.put(C.eventDeliveries, { ...record, started: result.started.map((w) => w.id), continued: result.continued });
    return { ...result, duplicate: false, deliveryRecord: record.id };
  }

  private async route(events: IncomingEvent[], opts: { attachments?: Attachment[]; envelope?: string }): Promise<Omit<HandleResult, "duplicate">> {
    const first = events[0]!;
    // A merge to a factory's config repo applies the new definition.
    if (first.provider === "github" && first.event === "push") {
      const synced: string[] = [];
      for (const f of this.k.defs.list()) {
        const r = f.definitionRepo;
        if (r && `${r.owner}/${r.name}` === first.data.repo && first.data.head === r.ref) {
          await this.k.defs.syncFromRepo(f.id, `push:${String(first.data.sha ?? "").slice(0, 7)}`);
          synced.push(f.id);
        }
      }
      if (synced.length) return { started: [], continued: synced, matched: [] };
    }
    const continued: string[] = [];
    for (const e of events) for (const id of await this.continueExisting(e)) if (!continued.includes(id)) continued.push(id);
    if (continued.length) return { started: [], continued, matched: [] };

    const started: WorkItem[] = [];
    const matched: HandleResult["matched"] = [];
    const aliases = this.k.defs.list().map((f) => f.alias.toLowerCase());
    for (const f of this.k.defs.list()) {
      if (f.status !== "active" || !f.appliedSha) continue;
      const resolved = this.k.defs.resolved(f.appliedSha);
      const aliasMap = this.aliasMap(f.appliedSha);
      for (const a of Object.values(resolved.automations)) {
        if (!a.enabled) continue;
        for (const ev of events) {
          if (!this.reaches(ev, f.id, f.alias, resolved, aliases)) continue;
          const t = a.triggers.find((tr) => evaluateTrigger(tr, ev, { aliases: aliasMap[a.name] }).ok);
          if (!t) continue;
          started.push(await this.start(f.id, resolved, a, ev, opts));
          matched.push({ factory: f.id, automation: a.name, event: ev.event });
          break;
        }
      }
      // A factory without automations still answers direct mentions of its alias.
      const mention = events.find((e) => this.mentionsFactory(e, f.alias));
      if (!started.some((w) => w.factory === f.id) && mention && !Object.keys(resolved.automations).length) {
        const foreman = Object.values(resolved.agents).find((x) => x.agentType === "FOREMAN")!.name;
        started.push(await this.startWith(f.id, "mention", foreman, "", mention, true, undefined, opts));
      }
    }
    return { started, continued: [], matched };
  }

  /** Whether an event may reach a factory: routing labels, named aliases, opted-in integrations and channels. */
  private reaches(ev: IncomingEvent, factoryId: string, alias: string, resolved: ResolvedFactory, allAliases: string[]): boolean {
    const routeTo = ev.data.routeTo as string[] | undefined;
    if (routeTo && !routeTo.includes(factoryId)) return false;
    if (["app_mention", "slash_command", "message_dm"].includes(ev.event)) {
      const named = (ev.data.mentioned ?? []).filter((m) => allAliases.includes(m));
      if (named.length && !named.includes(alias.toLowerCase())) return false;
    }
    const type = INTEGRATION_OF[ev.provider];
    if (!type) return true;
    const settings = resolved.factory.integrations.find((i) => i.type === type);
    // Opt-in applies once the provider is connected for the workspace; env-configured setups reach every factory.
    if (!settings) return !this.k.connections?.isConnected(type === "microsoft-teams" ? "microsoft-teams" : type);
    const channel = String(ev.data.channel ?? "");
    if (type === "slack" && settings.slack?.channels?.length) return settings.slack.channels.includes(channel) || ev.event === "message_dm" || ev.event === "message_im";
    if (type === "discord" && settings.discord?.channelIds?.length && !settings.discord.channelIds.some((c) => (ev.data.channel_ids ?? []).includes(c))) return false;
    if (type === "discord" && settings.discord?.guildIds?.length && !settings.discord.guildIds.some((g) => ((ev.data.guild_ids as string[] | undefined) ?? []).includes(g))) return false;
    if (type === "microsoft-teams" && settings["microsoft-teams"]?.teams?.length) {
      return settings["microsoft-teams"].teams.some((t) => (ev.data.team_ids ?? []).includes(t.teamId) && t.channelIds.some((c) => (ev.data.channel_ids ?? []).includes(c)));
    }
    return true;
  }

  private mentionsFactory(event: IncomingEvent, alias: string) {
    return (event.data.mentioned ?? []).includes(alias.toLowerCase()) && MENTION_EVENTS.includes(event.event);
  }

  /** Kept for callers that check one trigger. */
  triggerMatches(t: Trigger, event: IncomingEvent, _alias?: string): boolean {
    return evaluateTrigger(t, event).ok;
  }

  // ---------------------------------------------------------------------------------------------
  // Starting work

  private async start(factory: string, resolved: ResolvedFactory, a: ResolvedAutomation, event: IncomingEvent, opts: { attachments?: Attachment[]; envelope?: string } = {}) {
    const viaForeman = resolved.agents[a.agent]?.agentType === "FOREMAN";
    const fm = resolved.parsed.automations[a.name]?.frontmatter;
    const execution: ExecutionOverrides = {
      harness: fm?.harness ? a.harness.type : undefined,
      model: fm?.model || fm?.harness ? a.harness.model : undefined,
      runner: fm?.runner ?? undefined,
      secrets: fm?.secrets ?? undefined,
      mcpServers: fm?.mcpServers ?? undefined,
      environmentId: fm?.environmentId ?? undefined,
      workerHost: fm?.workerHost ?? undefined,
      idleTimeoutMinutes: fm?.idleTimeoutMinutes,
      requiredRepos: fm?.required_repos?.map((r) => (typeof r === "string" ? r : `${r.owner}/${r.name}`)),
    };
    const hasOverrides = Object.values(execution).some((v) => v !== undefined);
    return this.startWith(factory, a.name, a.agent, a.prompt, event, viaForeman, hasOverrides ? execution : undefined, opts);
  }

  private async startWith(factory: string, automation: string, agent: string, prompt: string, event: IncomingEvent, viaForeman: boolean, execution: ExecutionOverrides | undefined, opts: { attachments?: Attachment[]; envelope?: string } = {}) {
    const d = event.data;
    const title = String(d.title ?? d.text ?? `${event.provider} ${event.event}`).replace(/<@[^>]+>\s*/g, "").split("\n")[0]!.slice(0, 120) || `${event.event}`;
    const body = d.body ?? (d.title ? d.text : String(d.text ?? "").split("\n").slice(1).join("\n")) ?? "";
    const wi = await this.k.workflow.create({
      factory,
      title,
      body: [body, opts.envelope ? `\n---\n${opts.envelope}` : "", prompt ? `\n---\nAutomation "${automation}": ${prompt}` : ""].join("").trim(),
      source: {
        provider: event.provider === "factory" ? "kiln" : (event.provider as WorkItem["source"]["provider"]),
        url: d.url as string | undefined,
        repo: d.repo,
        number: d.number,
        issueId: d.issueId,
        channel: d.channel,
        thread: d.thread,
        automation,
        sessionId: d.sessionId as string | undefined,
        user: (d.user_ids as string[] | undefined)?.[0] ?? (d.author as string | undefined),
        serviceUrl: d.serviceUrl as string | undefined,
        discussionId: d.discussionId as string | undefined,
        deliveryId: event.deliveryId,
      },
      requester: this.person(event.provider, String(d.author ?? event.provider)),
      trackerKey: event.provider === "linear" || event.provider === "jira" ? d.issueId : undefined,
      directAgent: viaForeman ? undefined : agent,
      prompt,
      attachments: opts.attachments,
      execution,
    });
    void this.k.workflow.advance(wi.id);
    return wi;
  }

  /** The Kiln person behind a provider identity (linked accounts, the static map, then email). */
  person(provider: string, external: string): string {
    return this.k.users.resolveIdentity(provider, external);
  }

  /** Factory-internal events (stage changes) only reach automations of the same factory. */
  async handleFactoryEvent(factory: string, event: IncomingEvent): Promise<WorkItem[]> {
    const f = this.k.defs.get(factory);
    if (!f?.appliedSha) return [];
    const resolved = this.k.defs.resolved(f.appliedSha);
    const to = String(event.data.to ?? "");
    const ev: IncomingEvent = { ...event, data: { ...event.data, stages: [to, STAGE_OF_STATE[to]].filter(Boolean) } };
    const started: WorkItem[] = [];
    for (const a of Object.values(resolved.automations)) {
      if (!a.enabled || !a.triggers.some((t) => evaluateTrigger(t, ev).ok)) continue;
      started.push(await this.start(factory, resolved, { ...a, name: `stage:${a.name}` }, ev));
    }
    return started;
  }

  // ---------------------------------------------------------------------------------------------
  // Continuing work

  /** Thread replies, comments, session prompts and merges that belong to work already in flight. */
  private async continueExisting(event: IncomingEvent): Promise<string[]> {
    const d = event.data;
    const items = this.k.workflow.list();
    if (event.provider === "github" && event.event === "pull_request_merged" && d.repo && d.number) {
      const wi = await this.k.workflow.onPullRequestMerged(d.repo, d.number, d.mergedBy as string | undefined);
      return wi ? [wi.id] : [];
    }
    if (["gitlab", "azure_devops", "bitbucket"].includes(event.provider) && (event.event === "pull_request_merged" || (event.event === "merge_request" && d.action === "merge")) && d.repo && d.number) {
      const wi = await this.k.workflow.onPullRequestMerged(d.repo, d.number, String(d.author ?? ""));
      return wi ? [wi.id] : [];
    }
    if (event.provider === "github" && event.event === "pull_request_review_submitted" && d.repo && d.number && d.state !== "approved") {
      const wi = items.find((w) => w.pr !== undefined && w.pr.repo === d.repo && w.pr.number === d.number);
      if (wi) {
        await this.k.workflow.onReviewSubmitted(d.repo, d.number, String(d.text ?? "changes requested"), String(d.author ?? "reviewer"));
        return [wi.id];
      }
    }
    // Only comments, replies and session prompts continue work; labels, pushes and state changes start new work or nothing.
    const continuing = ["app_mention", "message_posted", "message_dm", "message_im", "message_mpim", "issue_commented", "pull_request_commented", "issue_mentioned", "pull_request_mentioned", "comment_created", "agent_session_prompted", "bot_mentioned", "work_item_mentioned", "slash_command"];
    if (!continuing.includes(event.event)) return [];
    if (d.authorIsSelf) return [];
    const match = items.find(
      (w) =>
        (d.thread && w.source.channel === d.channel && w.source.thread === d.thread) ||
        (d.thread && w.source.channel === d.thread) ||
        (d.sessionId && w.source.sessionId === d.sessionId) ||
        (d.issueId && (w.source.issueId === d.issueId || w.trackerKey === d.issueId)) ||
        (d.repo && d.number && ((w.source.repo === d.repo && w.source.number === d.number) || (w.pr !== undefined && w.pr.repo === d.repo && w.pr.number === d.number))),
    );
    if (!match) return [];
    if (["complete", "cancelled", "failed"].includes(match.state)) return [];
    // A plain thread reply needs a mention when the factory turned auto-respond off.
    const chat = CHAT_SETTINGS[event.provider];
    if (chat && d.isThreadReply) {
      const settings = this.k.defs.resolved(match.definitionSha).factory.integrations.find((i) => i.type === chat);
      const auto = (settings?.[chat] as { autoRespondToThreadReplies?: boolean } | undefined)?.autoRespondToThreadReplies;
      if (auto === false) return [];
    }
    // The app_mention event carries the same message; the plain message event is redundant.
    if (event.event === "message_posted" && d.mentionsBot) return [match.id];
    const text = String(d.text ?? "").replace(/<@[^>]+>\s*/g, "").trim();
    if (!text) return [match.id];
    const author = this.person(event.provider, String(d.author ?? event.provider));
    const open = this.k.gates.list({ workItemId: match.id, state: "open" });
    // Text in a thread or comment is content, not authority: only a gate's assignees decide it.
    const mayDecide = (g: { assignees: string[] }) => g.assignees.length === 0 || g.assignees.includes(author);
    const question = open.find((g) => g.kind === "question" && !g.command && mayDecide(g));
    const approval = open.find((g) => (g.kind === "spec" || g.kind === "preview") && mayDecide(g));
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

  // ---------------------------------------------------------------------------------------------
  // Aliases (resolved when a definition is applied)

  /** Alias lists (teams, projects, channels, users…) resolved per automation for one definition. */
  aliasMap(sha: string): Record<string, AliasMap> {
    return this.k.store.get<{ id: string; map: Record<string, AliasMap> }>(C.aliasMaps, sha)?.map ?? {};
  }

  /**
   * Resolve every alias list against the connected providers' directories. Returns errors for
   * names that don't resolve (apply fails on them) and stores the map under the definition sha.
   */
  resolveAliases(resolved: ResolvedFactory, opts: { save?: boolean } = {}): { errors: string[] } {
    const errors: string[] = [];
    const map: Record<string, AliasMap> = {};
    for (const [name, a] of Object.entries(resolved.parsed.automations)) {
      for (const [i, t] of a.frontmatter.triggers.entries()) {
        for (const [key, value] of Object.entries(t.filter ?? {})) {
          if (!ALIAS_KEYS[key] || !Array.isArray(value)) continue;
          for (const raw of value) {
            const ids = this.k.connections?.resolveName(t.provider, key, String(raw));
            if (!ids?.length) {
              errors.push(`automations/${name}: triggers.${i}.filter.${key}: ${raw} is not a known ${t.provider} ${key.replace(/s$/, "")}${this.k.connections?.isConnected(t.provider === "teams" ? "microsoft-teams" : (t.provider as never)) ? "" : `; connect ${t.provider} first`}`);
              continue;
            }
            ((map[name] ??= {})[`${key}:${raw}`] = ids);
          }
        }
      }
    }
    if (!errors.length && opts.save !== false) this.k.store.put(C.aliasMaps, { id: resolved.sha, map });
    return { errors };
  }

  /** Webhook triggers that name no file webhook and no managed webhook of the factory (they won't fire). */
  webhookWarnings(resolved: ResolvedFactory, factory: string): string[] {
    const out: string[] = [];
    const managed = this.k.store.list<{ id: string; factory: string; name: string }>(C.webhookSources, (w) => w.factory === factory);
    for (const [name, a] of Object.entries(resolved.parsed.automations)) {
      for (const t of a.frontmatter.triggers) {
        if (t.provider !== "webhook") continue;
        const id = webhookIdOf(t.filter);
        if (id && !resolved.parsed.webhooks[id] && !managed.some((w) => w.id === id || w.name === id)) out.push(`automations/${name}: webhook ${id} does not exist yet; the trigger fires once it does`);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Test filter

  /** Evaluate an automation's triggers against a stored delivery, with every check's outcome. */
  testFilter(factory: string, automation: string, deliveryId: string): { wouldTrigger: boolean; delivery: string; triggers: { index: number; provider: string; event: string; wouldTrigger: boolean; checks: CheckOutcome[] }[] } {
    const resolved = this.k.defs.current(factory);
    const a = resolved.automations[automation];
    if (!a) throw new Error(`unknown automation ${automation}`);
    const d = this.delivery(deliveryId) ?? this.k.webhookSources?.deliveryAsEvent(deliveryId);
    if (!d) throw new Error(`unknown delivery ${deliveryId}`);
    const aliases = this.aliasMap(resolved.sha)[automation];
    const triggers = a.triggers.map((t, index) => {
      const outcomes = d.events.map((e) => evaluateTrigger(t, { provider: d.provider, event: e.event, deliveryId: d.deliveryId, data: e.data }, { aliases }));
      // Prefer the event that matched, else the one that got furthest (the same provider and event).
      const best = outcomes.find((o) => o.ok) ?? outcomes.find((o) => o.checks.slice(0, 2).every((c) => c.ok)) ?? outcomes[0] ?? { ok: false, checks: [] };
      return { index, provider: t.provider, event: t.event, wouldTrigger: best.ok, checks: best.checks };
    });
    return { wouldTrigger: a.enabled && triggers.some((t) => t.wouldTrigger), delivery: d.id, triggers };
  }

  // ---------------------------------------------------------------------------------------------
  // Schedules

  /** Fire due schedule triggers. Each schedule keeps its last fire time in the store. */
  async tick() {
    const now = this.k.clock.now();
    for (const f of this.k.defs.list()) {
      if (f.status !== "active" || !f.appliedSha) continue;
      const resolved = this.k.defs.resolved(f.appliedSha);
      for (const a of Object.values(resolved.automations)) {
        if (!a.enabled) continue;
        for (const t of a.triggers) {
          if (t.provider !== "schedule" || !t.schedule) continue;
          // Changing only cron keeps the identity (and its last fire); changing name replaces it.
          const id = scheduleId(f.id, a.name, t.schedule.name);
          const existing = this.k.store.get<{ id: string; lastFired?: string; createdAt: string; cron: string }>(C.schedules, id);
          const state = existing ?? { id, createdAt: now.toISOString(), cron: t.schedule.cron };
          if (!existing) this.k.store.put(C.schedules, state);
          const cron = parseCron(t.schedule.cron);
          const due = cron.next(new Date(state.lastFired ?? state.createdAt));
          if (due > now) continue;
          this.k.store.put(C.schedules, { ...state, cron: t.schedule.cron, lastFired: now.toISOString() });
          const ev: IncomingEvent = { provider: "schedule", event: "cron_fired", deliveryId: `${id}@${now.toISOString()}`, data: { title: `${a.name} (${t.schedule.name ?? t.schedule.cron})`, author: "schedule", schedule_id: id, authorIsSelf: false } };
          if (!evaluateTrigger(t, ev).ok) continue;
          await this.start(f.id, resolved, a, ev);
        }
      }
    }
    this.pruneDeliveries();
  }
}

/** Stable schedule identity: factory/automation/name (unnamed schedules use "default"). */
export function scheduleId(factory: string, automation: string, name?: string) {
  return `${factory}/${automation}/${name ?? "default"}`;
}
