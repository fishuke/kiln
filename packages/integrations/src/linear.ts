import { mentionsIn, uniq, type IncomingEvent } from "./events";
import { jsonRequest, type Fetch } from "./http";

type Payload = Record<string, any>;

export type LinearNormalizeOptions = {
  /** The Linear app user id of the factory; its own activity never triggers. */
  appUserId?: string;
};

function issueFields(i: Payload) {
  return {
    issueId: i.id as string | undefined,
    issue_ids: uniq([i.id, i.identifier]),
    issue_numbers: i.number !== undefined ? [i.number] : [],
    identifier: i.identifier,
    title: i.title,
    body: (i.description ?? "") as string,
    url: i.url,
    team_ids: uniq([i.teamId ?? i.team?.id]),
    team_names: uniq([i.team?.name, i.team?.key]),
    project_ids: uniq([i.projectId ?? i.project?.id]),
    project_names: uniq([i.project?.name]),
    state_ids: uniq([i.stateId ?? i.state?.id]),
    state_names: uniq([i.state?.name]),
    assignee_ids: uniq([i.assigneeId ?? i.assignee?.id]),
    creator_ids: uniq([i.creatorId ?? i.creator?.id]),
    labels: ((i.labels ?? []) as { name: string }[]).map((l) => l.name),
    label_ids: (i.labelIds ?? []) as string[],
    mentioned: mentionsIn(i.description),
  };
}

/**
 * Linear webhooks → automation events: issue_created, issue_assigned, issue_labeled,
 * issue_state_changed, comment_created, agent_session_created. `agent_session_prompted`
 * (a reply inside a session) continues the work item it belongs to.
 */
export function normalizeLinearEvents(payload: Payload, deliveryId?: string, options: LinearNormalizeOptions = {}): IncomingEvent[] {
  const actor = payload.actor ?? {};
  const isSelf = Boolean(options.appUserId && actor.id === options.appUserId) || actor.type === "OauthClient";
  const self = { author: actor.name ?? actor.email ?? actor.id, authorIsSelf: isSelf, authorIsBot: isSelf || actor.type === "integration" || actor.type === "OauthClient" };
  const d = payload.data ?? {};
  const ev = (event: string, data: IncomingEvent["data"]): IncomingEvent => ({ provider: "linear", event, deliveryId, data: { ...self, ...data } });
  if (payload.type === "Issue") {
    const fields = { ...issueFields(d), url: payload.url ?? d.url };
    if (payload.action === "create") return [ev("issue_created", fields)];
    if (payload.action !== "update") return [];
    const from = payload.updatedFrom ?? {};
    const out: IncomingEvent[] = [];
    if ("assigneeId" in from && (d.assigneeId ?? d.assignee?.id)) out.push(ev("issue_assigned", { ...fields, assignee: d.assignee?.name }));
    if ("labelIds" in from) {
      const before = new Set((from.labelIds ?? []) as string[]);
      const added = ((d.labelIds ?? []) as string[]).filter((id) => !before.has(id));
      if (added.length) out.push(ev("issue_labeled", { ...fields, added_label_ids: added }));
    }
    if ("stateId" in from) out.push(ev("issue_state_changed", { ...fields, previous_state_id: from.stateId }));
    return out;
  }
  if (payload.type === "Comment" && payload.action === "create") {
    const issue = d.issue ?? {};
    return [
      ev("comment_created", {
        ...issueFields({ ...issue, id: d.issueId ?? issue.id }),
        text: d.body,
        commentId: d.id,
        creator_ids: uniq([d.userId ?? d.user?.id]),
        mentioned_user_ids: uniq([...String(d.body ?? "").matchAll(/linear\.app\/[^/]+\/profiles\/([\w-]+)/g)].map((m) => m[1])),
        mentioned: mentionsIn(d.body),
        url: payload.url ?? d.url,
      }),
    ];
  }
  if (payload.type === "AgentSessionEvent") {
    const s = payload.agentSession ?? {};
    const issue = s.issue ?? {};
    const fields = { ...issueFields(issue), sessionId: s.id, creator_ids: uniq([s.creatorId ?? s.creator?.id]) };
    if (payload.action === "created") return [ev("agent_session_created", { ...fields, text: s.comment?.body ?? payload.promptContext, authorIsSelf: false, authorIsBot: false })];
    if (payload.action === "prompted") return [ev("agent_session_prompted", { ...fields, text: payload.agentActivity?.content?.body ?? payload.agentActivity?.body, authorIsSelf: false, authorIsBot: false })];
  }
  return [];
}

export function normalizeLinear(payload: Payload, deliveryId?: string, options?: LinearNormalizeOptions): IncomingEvent | undefined {
  return normalizeLinearEvents(payload, deliveryId, options)[0];
}

// ---------------------------------------------------------------------------------------------
// Agent sessions: live progress inside the Linear issue

/** `options` on an elicitation asks with Linear's select signal: the person picks one, and the pick comes back as their reply. */
export type AgentActivity = { type: "thought" | "action" | "response" | "elicitation" | "error"; body: string; action?: string; parameter?: string; result?: string; options?: string[] };

export interface LinearAgentApi {
  /** Post progress into a session (thought / action / response / elicitation / error). */
  activity(sessionId: string, activity: AgentActivity): Promise<void>;
  /** Attach a pull request (or any link) to an issue. */
  attachLink(issueId: string, url: string, title: string): Promise<void>;
  /** Move an issue to a workflow state by id or by name. */
  updateState(issueId: string, state: { id?: string; name?: string }): Promise<void>;
  /** Teams, projects, states and users by name, for alias resolution. */
  directory(): Promise<{ teams: Record<string, string>; projects: Record<string, string>; states: Record<string, string>; users: Record<string, string> }>;
}

export class FakeLinearAgentApi implements LinearAgentApi {
  readonly activities: { sessionId: string; activity: AgentActivity }[] = [];
  readonly links: { issueId: string; url: string; title: string }[] = [];
  readonly states: { issueId: string; state: { id?: string; name?: string } }[] = [];
  constructor(readonly dir = { teams: { Engineering: "team_eng", ENG: "team_eng" } as Record<string, string>, projects: {} as Record<string, string>, states: { Done: "state_done", "In Progress": "state_wip" } as Record<string, string>, users: {} as Record<string, string> }) {}
  async activity(sessionId: string, activity: AgentActivity) {
    this.activities.push({ sessionId, activity });
  }
  async attachLink(issueId: string, url: string, title: string) {
    this.links.push({ issueId, url, title });
  }
  async updateState(issueId: string, state: { id?: string; name?: string }) {
    this.states.push({ issueId, state });
  }
  async directory() {
    return this.dir;
  }
}

/** Linear GraphQL with an OAuth app token (actor=app) or an API key. */
export class HttpLinearAgentApi implements LinearAgentApi {
  constructor(private readonly options: { token: string; fetch?: Fetch }) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const auth = this.options.token.startsWith("lin_api_") ? this.options.token : `Bearer ${this.options.token}`;
    const body = await jsonRequest<{ data?: T; errors?: { message: string }[] }>("Linear", this.options.fetch ?? fetch, "POST", "https://api.linear.app/graphql", { authorization: auth }, { query, variables });
    if (body?.errors?.length) throw new Error(`Linear: ${body.errors.map((e) => e.message).join("; ")}`);
    return body!.data as T;
  }

  async activity(sessionId: string, activity: AgentActivity) {
    const content: Record<string, unknown> = { type: activity.type };
    if (activity.type === "action") Object.assign(content, { action: activity.action ?? activity.body, parameter: activity.parameter ?? "", ...(activity.result ? { result: activity.result } : {}) });
    else content.body = activity.body;
    const select = activity.type === "elicitation" && activity.options?.length ? { signal: "select", signalMetadata: { options: activity.options.map((value) => ({ value })) } } : {};
    await this.gql(`mutation($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }`, { input: { agentSessionId: sessionId, content, ...select } });
  }

  async attachLink(issueId: string, url: string, title: string) {
    await this.gql(`mutation($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success } }`, { issueId, url, title });
  }

  async updateState(issueId: string, state: { id?: string; name?: string }) {
    let stateId = state.id;
    if (!stateId && state.name) {
      const r = await this.gql<{ issue: { team: { states: { nodes: { id: string; name: string }[] } } } }>(`query($id: String!) { issue(id: $id) { team { states { nodes { id name } } } } }`, { id: issueId });
      stateId = r.issue.team.states.nodes.find((s) => s.name.toLowerCase() === state.name!.toLowerCase())?.id;
      if (!stateId) throw new Error(`Linear team has no state named ${state.name}`);
    }
    await this.gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: issueId, input: { stateId } });
  }

  async directory() {
    const r = await this.gql<{ teams: { nodes: { id: string; name: string; key: string; states: { nodes: { id: string; name: string }[] } }[] }; projects: { nodes: { id: string; name: string }[] }; users: { nodes: { id: string; name: string; email: string }[] } }>(
      `query { teams(first: 100) { nodes { id name key states { nodes { id name } } } } projects(first: 200) { nodes { id name } } users(first: 250) { nodes { id name email } } }`,
    );
    const teams: Record<string, string> = {};
    const states: Record<string, string> = {};
    for (const t of r.teams.nodes) {
      teams[t.name] = t.id;
      teams[t.key] = t.id;
      for (const s of t.states.nodes) states[s.name] ??= s.id;
    }
    return {
      teams,
      states,
      projects: Object.fromEntries(r.projects.nodes.map((p) => [p.name, p.id])),
      users: Object.fromEntries(r.users.nodes.flatMap((u) => [[u.name, u.id], [u.email, u.id]])),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// OAuth (actor=app makes the factory a mentionable, assignable app user)

export function linearAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const q = new URLSearchParams({ client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: "read,write,app:assignable,app:mentionable", actor: "app", state: input.state, prompt: "consent" });
  return `https://linear.app/oauth/authorize?${q}`;
}

export async function linearExchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetch?: Fetch }) {
  const doFetch = input.fetch ?? fetch;
  const res = await doFetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri, grant_type: "authorization_code" }).toString(),
  });
  const body = (await res.json()) as { access_token?: string; scope?: string | string[]; error?: string };
  if (!body.access_token) throw new Error(`Linear OAuth failed: ${body.error ?? res.status}`);
  const me = await jsonRequest<{ data: { viewer: { id: string; name: string }; organization: { id: string; name: string; urlKey: string } } }>(
    "Linear",
    doFetch,
    "POST",
    "https://api.linear.app/graphql",
    { authorization: `Bearer ${body.access_token}` },
    { query: "query { viewer { id name } organization { id name urlKey } }" },
  );
  return { accessToken: body.access_token, scopes: Array.isArray(body.scope) ? body.scope : String(body.scope ?? "").split(/[ ,]/), appUserId: me.data.viewer.id, organization: me.data.organization };
}
