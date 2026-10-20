export type IssueState = "todo" | "in_progress" | "done" | "canceled";

export type TrackerIssue = {
  id: string;
  key: string;
  title: string;
  body: string;
  url: string;
  state: IssueState;
  labels: string[];
  parentId?: string;
  createdAt: string;
};

export interface Tracker {
  readonly name: "linear" | "jira" | "fake";
  createIssue(input: { title: string; body: string; labels?: string[]; parentId?: string; team?: string }): Promise<TrackerIssue>;
  getIssue(id: string): Promise<TrackerIssue | undefined>;
  comment(id: string, body: string): Promise<{ id: string }>;
  setState(id: string, state: IssueState): Promise<void>;
  listRecent(limit?: number): Promise<TrackerIssue[]>;
}

export class FakeTracker implements Tracker {
  readonly issues: TrackerIssue[] = [];
  readonly comments: { issueId: string; body: string }[] = [];

  constructor(
    readonly name: "linear" | "jira" | "fake" = "fake",
    private readonly prefix = "KIL",
  ) {}

  async createIssue(input: { title: string; body: string; labels?: string[]; parentId?: string }) {
    const n = this.issues.length + 1;
    const issue: TrackerIssue = {
      id: `${this.name}-${n}`,
      key: `${this.prefix}-${n}`,
      title: input.title,
      body: input.body,
      url: `https://tracker.test/${this.prefix}-${n}`,
      state: "todo",
      labels: input.labels ?? [],
      parentId: input.parentId,
      createdAt: new Date().toISOString(),
    };
    this.issues.push(issue);
    return issue;
  }

  async getIssue(id: string) {
    return this.issues.find((i) => i.id === id || i.key === id);
  }

  async comment(id: string, body: string) {
    this.comments.push({ issueId: id, body });
    return { id: `cm${this.comments.length}` };
  }

  async setState(id: string, state: IssueState) {
    const issue = await this.getIssue(id);
    if (issue) issue.state = state;
  }

  async listRecent(limit = 50) {
    return this.issues.slice(-limit).reverse();
  }
}

type Fetch = typeof fetch;

const LINEAR_STATE: Record<IssueState, string> = { todo: "unstarted", in_progress: "started", done: "completed", canceled: "canceled" };

export class LinearTracker implements Tracker {
  readonly name = "linear" as const;

  constructor(private readonly options: { apiKey: string; teamId: string; fetch?: Fetch }) {}

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await (this.options.fetch ?? fetch)("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: this.options.apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`Linear: ${body.errors.map((e) => e.message).join("; ")}`);
    return body.data as T;
  }

  private toIssue(i: Record<string, any>): TrackerIssue {
    const type = i.state?.type as string | undefined;
    const state = (Object.entries(LINEAR_STATE).find(([, v]) => v === type)?.[0] ?? "todo") as IssueState;
    return {
      id: i.id,
      key: i.identifier,
      title: i.title,
      body: i.description ?? "",
      url: i.url,
      state,
      labels: (i.labels?.nodes ?? []).map((l: { name: string }) => l.name),
      parentId: i.parent?.id,
      createdAt: i.createdAt,
    };
  }

  private fields = "id identifier title description url createdAt state { type } labels { nodes { name } } parent { id }";

  /** Linear takes label ids; look names up and create the missing ones on the team. */
  private async labelIds(names: string[], teamId: string): Promise<string[]> {
    if (!names.length) return [];
    const found = await this.gql<{ issueLabels: { nodes: { id: string; name: string }[] } }>(
      `query($names: [String!]) { issueLabels(filter: { name: { in: $names } }) { nodes { id name } } }`,
      { names },
    );
    const ids = new Map(found.issueLabels.nodes.map((l) => [l.name, l.id]));
    for (const name of names) {
      if (ids.has(name)) continue;
      const created = await this.gql<{ issueLabelCreate: { issueLabel: { id: string } } }>(
        `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`,
        { input: { name, teamId } },
      );
      ids.set(name, created.issueLabelCreate.issueLabel.id);
    }
    return names.map((n) => ids.get(n)!);
  }

  async createIssue(input: { title: string; body: string; labels?: string[]; parentId?: string; team?: string }) {
    const teamId = input.team ?? this.options.teamId;
    const labelIds = await this.labelIds(input.labels ?? [], teamId);
    const data = await this.gql<{ issueCreate: { issue: Record<string, any> } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${this.fields} } } }`,
      { input: { teamId, title: input.title, description: input.body, parentId: input.parentId, ...(labelIds.length ? { labelIds } : {}) } },
    );
    return this.toIssue(data.issueCreate.issue);
  }

  async getIssue(id: string) {
    const data = await this.gql<{ issue: Record<string, any> | null }>(`query($id: String!) { issue(id: $id) { ${this.fields} } }`, { id });
    return data.issue ? this.toIssue(data.issue) : undefined;
  }

  async comment(id: string, body: string) {
    const data = await this.gql<{ commentCreate: { comment: { id: string } } }>(
      `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id } } }`,
      { input: { issueId: id, body } },
    );
    return { id: data.commentCreate.comment.id };
  }

  async setState(id: string, state: IssueState) {
    const data = await this.gql<{ team: { states: { nodes: { id: string; type: string }[] } } }>(
      `query($team: String!) { team(id: $team) { states { nodes { id type } } } }`,
      { team: this.options.teamId },
    );
    const target = data.team.states.nodes.find((s) => s.type === LINEAR_STATE[state]);
    if (!target) throw new Error(`Linear team has no ${LINEAR_STATE[state]} state`);
    await this.gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
      id,
      input: { stateId: target.id },
    });
  }

  async listRecent(limit = 50) {
    const data = await this.gql<{ issues: { nodes: Record<string, any>[] } }>(
      `query($team: ID!, $n: Int!) { issues(first: $n, orderBy: createdAt, filter: { team: { id: { eq: $team } } }) { nodes { ${this.fields} } } }`,
      { team: this.options.teamId, n: limit },
    );
    return data.issues.nodes.map((i) => this.toIssue(i));
  }
}

const JIRA_CATEGORY: Record<IssueState, string> = { todo: "new", in_progress: "indeterminate", done: "done", canceled: "done" };

export class JiraTracker implements Tracker {
  readonly name = "jira" as const;

  constructor(private readonly options: { baseUrl: string; email: string; apiToken: string; projectKey: string; fetch?: Fetch }) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.options.email}:${this.options.apiToken}`).toString("base64");
    const res = await (this.options.fetch ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/rest/api/3${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return undefined as T;
    if (!res.ok) throw new Error(`Jira ${method} ${path} returned ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private adf(text: string) {
    return { type: "doc", version: 1, content: text.split("\n\n").map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })) };
  }

  private plain(adf: any): string {
    if (!adf) return "";
    if (typeof adf === "string") return adf;
    return (adf.content ?? []).map((n: any) => (n.text ?? this.plain(n))).join(n_join(adf));
  }

  private toIssue(i: Record<string, any>): TrackerIssue {
    const cat = i.fields?.status?.statusCategory?.key as string | undefined;
    const state: IssueState = cat === "done" ? "done" : cat === "indeterminate" ? "in_progress" : "todo";
    return {
      id: i.id,
      key: i.key,
      title: i.fields?.summary ?? "",
      body: this.plain(i.fields?.description),
      url: `${this.options.baseUrl.replace(/\/$/, "")}/browse/${i.key}`,
      state,
      labels: i.fields?.labels ?? [],
      parentId: i.fields?.parent?.id,
      createdAt: i.fields?.created ?? new Date().toISOString(),
    };
  }

  async createIssue(input: { title: string; body: string; labels?: string[]; parentId?: string }) {
    const created = await this.api<{ id: string; key: string }>("POST", "/issue", {
      fields: {
        project: { key: this.options.projectKey },
        summary: input.title,
        description: this.adf(input.body),
        issuetype: { name: input.parentId ? "Sub-task" : "Task" },
        labels: input.labels ?? [],
        ...(input.parentId ? { parent: { id: input.parentId } } : {}),
      },
    });
    return (await this.getIssue(created.key)) ?? { id: created.id, key: created.key, title: input.title, body: input.body, url: "", state: "todo", labels: [], createdAt: new Date().toISOString() };
  }

  async getIssue(id: string) {
    const i = await this.api<Record<string, any> | undefined>("GET", `/issue/${encodeURIComponent(id)}`);
    return i ? this.toIssue(i) : undefined;
  }

  async comment(id: string, body: string) {
    const c = await this.api<{ id: string }>("POST", `/issue/${encodeURIComponent(id)}/comment`, { body: this.adf(body) });
    return { id: c.id };
  }

  async setState(id: string, state: IssueState) {
    const { transitions } = await this.api<{ transitions: { id: string; to: { statusCategory: { key: string } } }[] }>("GET", `/issue/${encodeURIComponent(id)}/transitions`);
    const t = transitions.find((x) => x.to.statusCategory.key === JIRA_CATEGORY[state]);
    if (!t) throw new Error(`no Jira transition to ${state}`);
    await this.api("POST", `/issue/${encodeURIComponent(id)}/transitions`, { transition: { id: t.id } });
  }

  async listRecent(limit = 50) {
    const r = await this.api<{ issues: Record<string, any>[] }>("POST", "/search/jql", {
      jql: `project = ${this.options.projectKey} ORDER BY created DESC`,
      maxResults: limit,
      fields: ["summary", "description", "status", "labels", "created", "parent"],
    });
    return (r?.issues ?? []).map((i) => this.toIssue(i));
  }
}

function n_join(adf: { type?: string }) {
  return adf.type === "doc" ? "\n\n" : "";
}
