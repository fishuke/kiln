import {
  AzureDevOpsForge,
  BitbucketForge,
  DiscordChat,
  GitLabForge,
  HttpJiraCloudApi,
  HttpLinearAgentApi,
  SlackChat,
  TeamsChat,
  factoryLabel,
  FACTORY_LABEL_PREFIX,
  GITHUB_BOT_HANDLE,
  repoKey,
  type BotFrameworkVerifier,
  type Chat,
  type ChatIdentity,
  type Forge,
  type ForgeKind,
  type HomeItem,
  type IncomingEvent,
  type JiraCloudApi,
  type LinearAgentApi,
  type RepoRef,
} from "@kiln/integrations";
import { importV1alpha1 } from "@kiln/definitions";
import type { Kiln } from "./kiln";
import { STAGE_OF_STATE } from "./matchers";
import type { FactoryBinding, WorkItem } from "./types";

/** Adapters per provider, beyond the primary forge/tracker/chat. */
export type IntegrationAdapters = {
  chats?: Partial<Record<"slack" | "discord" | "teams", Chat>>;
  forges?: Partial<Record<ForgeKind, Forge>>;
  linearAgent?: LinearAgentApi;
  jira?: JiraCloudApi;
  /** Validates Bot Framework tokens on /webhooks/teams (a Fake in tests). */
  teamsVerifier?: BotFrameworkVerifier;
};

export type NotificationRoute = {
  kind: "slack_dm" | "slack_thread" | "discord_dm" | "discord_thread" | "teams_thread" | "linear_issue" | "linear_session" | "jira_issue" | "github_comment" | "gitlab_comment" | "azure_devops_comment" | "bitbucket_comment";
  provider: string;
  available: boolean;
  target?: string;
  reason?: string;
};

const HOME_STAGE: Record<string, string> = { TRIAGE: "Triage", SPEC: "Planning", IMPLEMENT: "Building", REVIEW: "Reviewing", COMPLETE: "Complete", CANCELLED: "Cancelled" };
const FORGE_PROVIDERS = ["github", "gitlab", "azure_devops", "bitbucket"] as const;

/**
 * Glue between Kiln and the connected systems: posting back where work started, the GitHub
 * routing label and definition checks, Slack's Home tab, and Linear session progress.
 */
export class IntegrationHub {
  constructor(
    private readonly k: Kiln,
    private readonly adapters: IntegrationAdapters = {},
  ) {}

  private readonly cache = new Map<string, { at?: string; value: unknown }>();

  /** An adapter built from a workspace connection's credentials, rebuilt when the connection changes. */
  private fromConnection<T>(provider: string, build: (creds: Record<string, string>, inst: Record<string, unknown>) => T | undefined): T | undefined {
    const conn = this.k.connections.get(provider);
    if (conn?.status !== "connected") return undefined;
    const hit = this.cache.get(provider);
    if (hit && hit.at === conn.connectedAt) return hit.value as T | undefined;
    const value = build(this.k.connections.credentials(provider), conn.installation);
    this.cache.set(provider, { at: conn.connectedAt, value });
    return value;
  }

  chat(provider: "slack" | "discord" | "teams"): Chat | undefined {
    const explicit = this.adapters.chats?.[provider];
    if (explicit) return explicit;
    const primary = this.k.chat;
    // The primary chat serves its own provider; the local stand-in serves Slack.
    if (primary && (primary.name === provider || (provider === "slack" && primary.name === "fake"))) return primary;
    if (provider === "slack") return this.fromConnection("slack", (c) => (c.botToken ? new SlackChat({ botToken: c.botToken }) : undefined));
    if (provider === "discord") return this.fromConnection("discord", (c, i) => (c.botToken ? new DiscordChat({ botToken: c.botToken, applicationId: i.applicationId as string | undefined }) : undefined));
    return this.fromConnection("microsoft-teams", (c, i) => (c.appPassword && i.appId ? new TeamsChat({ appId: String(i.appId), appPassword: c.appPassword, tenantId: i.tenantId as string | undefined }) : undefined));
  }

  forgeFor(repo: RepoRef | string): Forge {
    const kind = typeof repo === "string" ? this.forgeKindOf(repo) : (repo.forge ?? this.forgeKindOf(repoKey(repo)));
    if (!kind || kind === this.k.forge.name) return this.k.forge;
    const explicit = this.adapters.forges?.[kind];
    if (explicit) return explicit;
    const built =
      kind === "gitlab"
        ? this.fromConnection("gitlab", (c, i) => (c.token ? new GitLabForge({ token: c.token, baseUrl: i.baseUrl as string | undefined }) : undefined))
        : kind === "azure_devops"
          ? this.fromConnection("azure_devops", (c, i) => (c.token ? new AzureDevOpsForge({ organization: String(i.organization), token: c.token }) : undefined))
          : kind === "bitbucket"
            ? this.fromConnection("bitbucket", (c) => (c.token ? new BitbucketForge({ token: c.token }) : undefined))
            : undefined;
    return built ?? this.k.forge;
  }

  get linearAgent(): LinearAgentApi | undefined {
    return this.adapters.linearAgent ?? this.fromConnection("linear", (c) => (c.accessToken ? new HttpLinearAgentApi({ token: c.accessToken }) : undefined));
  }

  get jira(): JiraCloudApi | undefined {
    return this.adapters.jira ?? this.fromConnection("jira", (c, i) => (c.accessToken && i.cloudId ? new HttpJiraCloudApi({ cloudId: String(i.cloudId), accessToken: c.accessToken }) : undefined));
  }

  /** The forge a repository is on, from any factory that lists it. */
  private forgeKindOf(key: string): ForgeKind | undefined {
    for (const f of this.k.defs.list()) {
      if (!f.appliedSha) continue;
      const r = this.k.defs.resolved(f.appliedSha).factory.repositories.find((x) => `${x.owner}/${x.name}` === key);
      if (r) return r.forge;
    }
    return undefined;
  }

  /**
   * How the factory appears in chat (Slack chat:write.customize): its name, and an avatar when
   * KILN_FACTORY_AVATAR_URL is set (a URL template with {alias}).
   */
  identityFor(factory: string): ChatIdentity | undefined {
    const b = this.k.defs.get(factory);
    if (!b) return undefined;
    const template = process.env.KILN_FACTORY_AVATAR_URL;
    return { name: b.name, iconUrl: template ? template.replaceAll("{alias}", encodeURIComponent(b.alias)) : undefined };
  }

  /** Post back where the work started. Returns false when there is nowhere to post. */
  async notify(wi: WorkItem, text: string): Promise<boolean> {
    const s = wi.source ?? { provider: "kiln" };
    if ((s.provider === "slack" || s.provider === "discord" || s.provider === "teams") && s.channel) {
      const chat = this.chat(s.provider);
      if (!chat) return false;
      await chat.post({ channel: s.channel, thread: s.thread, text, as: s.provider === "slack" ? this.identityFor(wi.factory) : undefined });
      this.k.bus.publish("message.posted", { channel: s.channel, thread: s.thread, text });
      return true;
    }
    if ((FORGE_PROVIDERS as readonly string[]).includes(s.provider) && s.repo && s.number) {
      const [owner, ...rest] = s.repo.split("/");
      const name = rest.pop()!;
      const repo: RepoRef = { owner: [owner, ...rest].join("/"), name, forge: s.provider as ForgeKind };
      const forge = this.forgeFor(repo);
      const reply = (forge as Forge & { replyInDiscussion?: (r: RepoRef, n: number, d: string, b: string) => Promise<unknown> }).replyInDiscussion;
      if (s.provider === "gitlab" && s.discussionId && reply) await reply.call(forge, repo, s.number, s.discussionId, text);
      else await forge.comment(repo, s.number, text);
      return true;
    }
    if (s.provider === "linear" && s.sessionId && this.linearAgent) {
      await this.linearAgent.activity(s.sessionId, { type: "response", body: text });
      return true;
    }
    if (s.provider === "jira" && (s.issueId ?? wi.trackerKey) && this.jira) {
      await this.jira.comment((s.issueId ?? wi.trackerKey)!, text);
      return true;
    }
    if ((s.provider === "linear" || s.provider === "jira") && (s.issueId ?? wi.trackerKey) && this.k.tracker) {
      await this.k.tracker.comment((s.issueId ?? wi.trackerKey)!, text);
      return true;
    }
    return false;
  }

  /** Acknowledge a chat message that started or continued work (Slack and Discord 👀). */
  async acknowledge(ev: IncomingEvent) {
    const chat = ev.provider === "slack" || ev.provider === "discord" ? this.chat(ev.provider) : undefined;
    const ts = (ev.data.ts as string | undefined) ?? ev.data.thread;
    if (!chat?.react || !ev.data.channel || !ts) return;
    await chat.react({ channel: ev.data.channel, ts, emoji: ev.provider === "slack" ? "eyes" : "👀" }).catch(() => {});
  }

  /** Where the factory can reach a person, given what is connected and linked. */
  notificationRoutes(input: { subject?: string; factory?: string; workItemId?: string }): NotificationRoute[] {
    const routes: NotificationRoute[] = [];
    const wi = input.workItemId ? this.k.workflow.get(input.workItemId) : undefined;
    const factory = input.factory ?? wi?.factory;
    const integrations = factory && this.k.defs.get(factory)?.appliedSha ? this.k.defs.current(factory).factory.integrations.map((i) => i.type) : undefined;
    const optedIn = (type: string, provider: string) => !integrations || integrations.includes(type as never) || !this.k.connections.isConnected(provider);
    const linked = (provider: string) => (input.subject ? this.k.identities.externalFor(provider, input.subject) : undefined);
    const dm = (kind: NotificationRoute["kind"], provider: "slack" | "discord", type: string) => {
      const chat = this.chat(provider);
      const user = linked(provider);
      routes.push({
        kind,
        provider,
        available: Boolean(chat?.directMessage && user && optedIn(type, provider)),
        target: user,
        reason: !chat ? `${provider} is not connected` : !chat.directMessage ? `${provider} cannot send direct messages` : !user ? `link your ${provider} account (sign in from ${provider})` : !optedIn(type, provider) ? `this factory does not use ${provider}` : undefined,
      });
    };
    dm("slack_dm", "slack", "slack");
    dm("discord_dm", "discord", "discord");
    routes.push({ kind: "teams_thread", provider: "teams", available: Boolean(this.chat("teams") && wi?.source.provider === "teams"), target: wi?.source.provider === "teams" ? wi.source.channel : undefined, reason: !this.chat("teams") ? "Microsoft Teams is not connected" : wi?.source.provider !== "teams" ? "Teams bots reply in the thread where the work started; they cannot DM" : undefined });
    if (wi?.source.provider === "slack" || wi?.source.provider === "discord") {
      routes.push({ kind: wi.source.provider === "slack" ? "slack_thread" : "discord_thread", provider: wi.source.provider, available: Boolean(this.chat(wi.source.provider)), target: wi.source.thread ?? wi.source.channel });
    }
    const tracker = (provider: "linear" | "jira") => {
      const key = wi?.source.provider === provider ? (wi.source.issueId ?? wi.trackerKey) : undefined;
      const can = provider === "linear" ? Boolean(this.linearAgent || this.k.tracker?.name === "linear" || this.k.tracker?.name === "fake") : Boolean(this.jira || this.k.tracker?.name === "jira");
      routes.push({ kind: provider === "linear" ? "linear_issue" : "jira_issue", provider, available: can && Boolean(key) && optedIn(provider, provider), target: key, reason: !can ? `${provider} is not connected` : !key ? `the work did not start from a ${provider} issue` : !optedIn(provider, provider) ? `this factory does not use ${provider}` : undefined });
    };
    tracker("linear");
    if (wi?.source.sessionId) routes.push({ kind: "linear_session", provider: "linear", available: Boolean(this.linearAgent), target: wi.source.sessionId, reason: this.linearAgent ? undefined : "Linear agent sessions need the Linear OAuth app" });
    tracker("jira");
    for (const provider of FORGE_PROVIDERS) {
      const fromHere = wi?.source.provider === provider && wi.source.repo && wi.source.number;
      const pr = wi?.pr && this.forgeKindOf(wi.pr.repo) === provider ? wi.pr : undefined;
      const target = fromHere ? `${wi!.source.repo}#${wi!.source.number}` : pr ? `${pr.repo}#${pr.number}` : undefined;
      const usable = provider === "github" ? true : Boolean(this.adapters.forges?.[provider]) || this.k.forge.name === provider;
      routes.push({ kind: `${provider}_comment` as NotificationRoute["kind"], provider, available: usable && Boolean(target), target, reason: !usable ? `${provider} is not connected` : !target ? "no issue or pull request to comment on yet" : undefined });
    }
    return routes;
  }

  // ---------------------------------------------------------------------------------------------
  // GitHub: routing labels, mention routing, attribution, definition checks

  private githubRepos(f: FactoryBinding): RepoRef[] {
    if (!f.appliedSha) return [];
    return this.k.defs
      .resolved(f.appliedSha)
      .factory.repositories.filter((r) => r.forge === "github" || r.forge === "gitlab")
      .map((r) => ({ owner: r.owner, name: r.name, forge: r.forge }));
  }

  /** Create `factory:<alias>` on the factory's repositories (idempotent). */
  async ensureFactoryLabels(factory: string) {
    const f = this.k.defs.get(factory);
    if (!f) return;
    for (const repo of this.githubRepos(f)) {
      const forge = this.forgeFor(repo);
      await forge.ensureLabel?.(repo, factoryLabel(f.alias), { description: `Routes @${GITHUB_BOT_HANDLE} mentions to the ${f.name} factory` }).catch((err: unknown) => this.k.audit("kiln", "label.failed", factory, { repo: repoKey(repo), error: String(err) }));
    }
  }

  /** When a factory is deleted: remove its routing labels. */
  async cleanupFactory(binding: FactoryBinding, repos: RepoRef[] = this.githubRepos(binding)) {
    for (const repo of repos) await this.forgeFor(repo).deleteLabel?.(repo, factoryLabel(binding.alias)).catch(() => {});
    this.k.audit("kiln", "factory.integrations_removed", binding.id, { labels: repos.map(repoKey) });
  }

  /**
   * Route `@kiln-factory` mentions on GitHub: a `factory:<alias>` label picks the factory; an
   * unlabeled mention goes to the one factory that works on the repo (and gets its label), or
   * asks which one when there are several.
   */
  async routeGitHubMentions(events: IncomingEvent[]): Promise<IncomingEvent[]> {
    const out: IncomingEvent[] = [];
    for (const ev of events) {
      const isMention = ev.provider === "github" && (ev.event === "issue_mentioned" || ev.event === "pull_request_mentioned") && (ev.data.mentioned ?? []).some((m) => m === GITHUB_BOT_HANDLE || m === `${GITHUB_BOT_HANDLE}[bot]`);
      if (!isMention || !ev.data.repo || ev.data.authorIsSelf) {
        out.push(ev);
        continue;
      }
      const labeled = (ev.data.labels ?? []).filter((l) => l.toLowerCase().startsWith(FACTORY_LABEL_PREFIX)).map((l) => l.slice(FACTORY_LABEL_PREFIX.length).toLowerCase());
      const factories = this.k.defs.list().filter((f) => f.status === "active" && f.appliedSha);
      await this.onboardingNotice(ev, factories);
      if (labeled.length) {
        out.push({ ...ev, data: { ...ev.data, routeTo: factories.filter((f) => labeled.includes(f.alias.toLowerCase())).map((f) => f.id) } });
        continue;
      }
      const candidates = factories.filter((f) => this.githubRepos(f).some((r) => repoKey(r) === ev.data.repo));
      const [owner, name] = String(ev.data.repo).split("/") as [string, string];
      const repo = { owner, name };
      const forge = this.forgeFor(repo);
      if (candidates.length === 1 && ev.data.number) {
        const f = candidates[0]!;
        await forge.addLabels(repo, ev.data.number, [factoryLabel(f.alias)]).catch(() => {});
        out.push({ ...ev, data: { ...ev.data, routeTo: [f.id], labels: [...(ev.data.labels ?? []), factoryLabel(f.alias)] } });
      } else if (ev.data.number) {
        const text = candidates.length
          ? `Several Kiln factories work on ${ev.data.repo}. Add one of these labels and mention @${GITHUB_BOT_HANDLE} again: ${candidates.map((f) => `\`${factoryLabel(f.alias)}\``).join(", ")}.`
          : `No Kiln factory works on ${ev.data.repo} yet. Add the repository to a factory, then mention @${GITHUB_BOT_HANDLE} again.`;
        await forge.comment(repo, ev.data.number, text).catch(() => {});
        out.push({ ...ev, data: { ...ev.data, routeTo: [] } });
      }
    }
    return out;
  }

  /**
   * Once per GitHub user: when the workspace links GitHub accounts and this person hasn't, say how
   * (work still starts). Factories turn it off with `automations.githubOnboardingNotices: false`.
   */
  private async onboardingNotice(ev: IncomingEvent, factories: FactoryBinding[]) {
    const author = ev.data.author;
    if (!author || !ev.data.repo || !ev.data.number) return;
    if (!this.k.identities.list().some((l) => l.provider === "github")) return;
    if (this.k.identities.lookup("github", author) || this.k.store.get("onboarding_notices", `github:${author}`)) return;
    const relevant = factories.filter((f) => this.githubRepos(f).some((r) => repoKey(r) === ev.data.repo));
    if (!relevant.length || relevant.every((f) => this.k.defs.resolved(f.appliedSha!).factory.automations?.githubOnboardingNotices === false)) return;
    this.k.store.put("onboarding_notices", { id: `github:${author}`, at: this.k.clock.now().toISOString() });
    const [owner, name] = String(ev.data.repo).split("/") as [string, string];
    await this.forgeFor({ owner, name }).comment({ owner, name }, ev.data.number, `@${author} link your GitHub account to Kiln so requests and approvals are recorded under your name: ${this.k.link("/integrations")}`).catch(() => {});
  }

  /** Comment on a factory PR saying which factory opened it and for whom. */
  async attribute(pr: { workItemId?: string; repo: string; number: number }) {
    const wi = pr.workItemId ? this.k.workflow.get(pr.workItemId) : undefined;
    if (!wi) return;
    const b = this.k.defs.get(wi.factory);
    const via = wi.source.url ? ` from [${wi.source.provider}](${wi.source.url})` : wi.source.provider !== "kiln" && wi.source.provider !== "api" ? ` from ${wi.source.provider}` : "";
    const text = `Opened by the **${b?.name ?? wi.factory}** Kiln factory for ${wi.requester}${via}. [Work item](${this.k.link(`/work-items/${wi.id}`)})\n\nA person reviews and merges; the factory never approves or merges.`;
    const [owner, name] = pr.repo.split("/") as [string, string];
    await this.forgeFor({ owner, name }).comment({ owner, name }, pr.number, text).catch((err: unknown) => this.k.audit("kiln", "attribution.failed", wi.id, { error: String(err) }));
  }

  /**
   * `kiln/factory-config` on pull requests to a factory's config repo: validate the head commit
   * and dry-run it (missing runners, routers, unresolved alias names), with a create/update/delete
   * summary. `github.factoryConfigChecks: main` (default) checks PRs to the production branch only.
   */
  async checkDefinitionPullRequest(ev: IncomingEvent): Promise<{ factory: string; conclusion: string } | undefined> {
    if (ev.provider !== "github" || !["pull_request_opened", "pull_request_synchronized", "pull_request_reopened", "pull_request_ready"].includes(ev.event)) return undefined;
    const f = this.k.defs.list().find((x) => x.definitionRepo && `${x.definitionRepo.owner}/${x.definitionRepo.name}` === ev.data.repo);
    if (!f?.definitionRepo || !ev.data.sha) return undefined;
    const current = f.appliedSha ? this.k.defs.current(f.id).factory : undefined;
    const mode = current?.github?.factoryConfigChecks ?? "main";
    if (mode === "main" && ev.data.base !== f.definitionRepo.ref) return undefined;
    const repo = { owner: f.definitionRepo.owner, name: f.definitionRepo.name };
    const name = `kiln/factory-config${f.definitionRepo.dir ? ` (${f.definitionRepo.dir})` : ""}`;
    const forge = this.forgeFor(repo);
    if (!forge.createCheckRun) return undefined;
    let tree = await forge.readTree(repo, String(ev.data.sha), f.definitionRepo.dir);
    if (/schemaVersion:\s*v1alpha1/.test(tree["factory.yaml"] ?? "")) tree = importV1alpha1(tree).tree;
    const diff = this.k.defs.diff(f.id, tree);
    const changes = diff.added.length + diff.changed.length + diff.removed.length;
    let conclusion: "success" | "failure" = "success";
    let summary: string;
    let text: string | undefined;
    if (!changes) {
      summary = "No definition changes.";
    } else {
      const dry = this.k.defs.apply(tree, { author: "factory-config-check", factory: f.id, dryRun: true });
      const errors = dry.ok ? [] : dry.errors;
      conclusion = errors.length ? "failure" : "success";
      summary = `${diff.added.length} to create, ${diff.changed.length} to update, ${diff.removed.length} to delete.${errors.length ? ` ${errors.length} problem${errors.length > 1 ? "s" : ""}.` : ""}`;
      text = [
        ...(diff.added.length ? ["**Create**", ...diff.added.map((x) => `- ${x}`)] : []),
        ...(diff.changed.length ? ["**Update**", ...diff.changed.map((x) => `- ${x}`)] : []),
        ...(diff.removed.length ? ["**Delete**", ...diff.removed.map((x) => `- ${x}`)] : []),
        ...(errors.length ? ["**Problems**", ...errors.map((e) => `- ${e}`)] : []),
      ].join("\n");
    }
    await forge.createCheckRun(repo, { name, headSha: String(ev.data.sha), status: "completed", conclusion, title: conclusion === "success" ? "Factory definition is valid" : "Factory definition has problems", summary, text, detailsUrl: this.k.link(`/factories/${f.id}`) });
    return { factory: f.id, conclusion };
  }

  // ---------------------------------------------------------------------------------------------
  // Slack Home tab, Linear sessions

  /** Work items a chat user asked for, grouped into the Home tab's stages. */
  homeItems(provider: string, user: string): HomeItem[] {
    const person = this.k.automations.person(provider, user);
    return this.k.workflow
      .list()
      .filter((w) => (w.source.provider === provider && w.source.user === user) || w.requester === person)
      .map((w) => ({ title: w.title, stage: HOME_STAGE[STAGE_OF_STATE[w.state] ?? "TRIAGE"] ?? "Triage", url: this.k.link(`/work-items/${w.id}`), updatedAt: w.updatedAt, factory: this.k.defs.get(w.factory)?.name ?? w.factory }));
  }

  /** Keep a Linear agent session up to date as the work moves. */
  async onStageChanged(wi: WorkItem, to: string) {
    const api = this.linearAgent;
    if (!api || !wi.source.sessionId) return;
    const stage = HOME_STAGE[STAGE_OF_STATE[to] ?? ""] ?? to;
    await api.activity(wi.source.sessionId, { type: "thought", body: `${stage}: ${wi.title}` }).catch(() => {});
  }

  async onPullRequestOpened(e: { workItemId?: string; repo: string; number: number; url: string }) {
    await this.attribute(e);
    const wi = e.workItemId ? this.k.workflow.get(e.workItemId) : undefined;
    const api = this.linearAgent;
    if (!wi || !api || wi.source.provider !== "linear") return;
    const issueId = wi.source.issueId ?? wi.trackerKey;
    if (issueId) await api.attachLink(issueId, e.url, `PR #${e.number}`).catch(() => {});
    if (wi.source.sessionId) await api.activity(wi.source.sessionId, { type: "action", body: "", action: "Opened pull request", parameter: e.url }).catch(() => {});
  }
}
