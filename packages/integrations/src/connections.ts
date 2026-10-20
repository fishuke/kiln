import { discordInstallUrl } from "./discord";
import { githubAppInstallUrl, HttpGitHubAppAuth } from "./github";
import { jsonRequest, type Fetch } from "./http";
import { jiraAuthorizeUrl, jiraExchangeCode } from "./jira";
import { linearAuthorizeUrl, linearExchangeCode } from "./linear";
import { slackExchangeCode, slackInstallUrl } from "./slack";

export const CONNECTION_PROVIDERS = ["github", "gitlab", "azure_devops", "bitbucket", "slack", "microsoft-teams", "discord", "linear", "jira"] as const;
export type ConnectionProviderId = (typeof CONNECTION_PROVIDERS)[number];
export type ConnectionStatus = "connected" | "pending_approval" | "error";

/** A field the person fills in for providers connected by pasting credentials. */
export type SetupField = { name: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string };

export type StartResult = {
  /** Where to send the browser (OAuth consent or app install), when there is one. */
  url?: string;
  /** What to do, in order, for self-hosters (create the app, paste credentials, add the webhook). */
  steps: string[];
  /** Fields to submit to `complete` for manual connections. */
  fields?: SetupField[];
};

export type CompleteInput = { code?: string; state?: string; params?: Record<string, string>; redirectUri: string; webhookUrl: string };

export type CompleteResult = {
  account: { id: string; name: string; url?: string };
  scopes: string[];
  /** Installation details safe to show (installation id, team id, cloud id, base URL…). */
  installation: Record<string, string | number | boolean | undefined>;
  /** Credentials stored encrypted in Kiln secrets, named KILN_CONN_<PROVIDER>_<KEY>. */
  secrets: Record<string, string>;
};

export type TestResult = { ok: boolean; message: string };

/** One external system Kiln can connect to at the workspace level. */
export interface ConnectionProvider {
  readonly id: ConnectionProviderId;
  readonly label: string;
  readonly mode: "oauth" | "install" | "manual";
  start(ctx: { state: string; redirectUri: string; webhookUrl: string }): StartResult;
  complete(input: CompleteInput): Promise<CompleteResult>;
  test(input: { installation: CompleteResult["installation"]; secrets: Record<string, string> }): Promise<TestResult>;
}

/** A provider for tests: start returns a URL, complete accepts code "ok", test reads secrets.token. */
export class FakeConnectionProvider implements ConnectionProvider {
  readonly mode = "oauth" as const;
  constructor(
    readonly id: ConnectionProviderId,
    readonly label: string = id,
  ) {}
  start(ctx: { state: string; redirectUri: string }) {
    return { url: `https://${this.id}.test/oauth?state=${ctx.state}&redirect_uri=${encodeURIComponent(ctx.redirectUri)}`, steps: [`Approve Kiln in ${this.label}`] };
  }
  async complete(input: CompleteInput) {
    if (input.code !== "ok" && !input.params?.token && !input.params?.installation_id) throw new Error(`${this.label} rejected the code`);
    return { account: { id: `${this.id}-acct`, name: `${this.label} workspace` }, scopes: ["read", "write"], installation: { site: `${this.id}.test` }, secrets: { token: input.params?.token ?? `tok_${this.id}` } };
  }
  async test(input: { secrets: Record<string, string> }) {
    return input.secrets.token === "bad" ? { ok: false, message: "token was rejected" } : { ok: true, message: `${this.label} answered` };
  }
}

/** OAuth app / app credentials for each provider, from the environment or the secrets store. */
export type ConnectionConfig = {
  github?: { appSlug?: string; appId?: string; privateKey?: string; clientId?: string; clientSecret?: string };
  slack?: { clientId?: string; clientSecret?: string };
  linear?: { clientId?: string; clientSecret?: string };
  jira?: { clientId?: string; clientSecret?: string };
  discord?: { applicationId?: string };
  fetch?: Fetch;
};

const need = <K extends string>(params: Record<string, string> | undefined, ...names: K[]): Record<K, string> & Record<string, string | undefined> => {
  const missing = names.filter((n) => !params?.[n]);
  if (missing.length) throw new Error(`missing ${missing.join(", ")}`);
  return params as Record<K, string> & Record<string, string | undefined>;
};

/** The real providers. Each works with the credentials a self-hoster creates for their own apps. */
export function connectionProviders(config: ConnectionConfig = {}): Record<ConnectionProviderId, ConnectionProvider> {
  const doFetch = config.fetch ?? fetch;
  const github: ConnectionProvider = {
    id: "github",
    label: "GitHub",
    mode: "install",
    start: ({ state, webhookUrl }) => ({
      url: config.github?.appSlug ? githubAppInstallUrl(config.github.appSlug, state) : undefined,
      steps: [
        "Create a GitHub App (Settings → Developer settings → GitHub Apps) with Contents, Issues, Pull requests, Checks: read & write, Metadata: read.",
        `Set its webhook URL to ${webhookUrl.replace(/\/[^/]+$/, "/github")} and subscribe to Issues, Issue comment, Pull request, Pull request review, Pull request review comment, Check suite, Check run, Status, Workflow run and Push.`,
        "Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG and GITHUB_WEBHOOK_SECRET, then install the app on your organization.",
      ],
      fields: config.github?.appSlug ? undefined : [{ name: "installation_id", label: "Installation id" }],
    }),
    complete: async ({ params }) => {
      const p = need(params, "installation_id");
      const appId = config.github?.appId;
      const key = config.github?.privateKey;
      let account = p.account ?? `installation ${p.installation_id}`;
      if (appId && key) {
        const auth = new HttpGitHubAppAuth({ appId, privateKey: key, installationId: p.installation_id, fetch: doFetch });
        const token = await auth.installationToken();
        const r = await jsonRequest<{ repositories: { owner: { login: string } }[] }>("GitHub", doFetch, "GET", "https://api.github.com/installation/repositories?per_page=1", { authorization: `Bearer ${token}` });
        account = r?.repositories?.[0]?.owner.login ?? account;
      }
      return { account: { id: p.installation_id, name: account, url: `https://github.com/${account}` }, scopes: ["contents", "issues", "pull_requests", "checks"], installation: { installationId: p.installation_id }, secrets: {} };
    },
    test: async ({ installation }) => {
      const appId = config.github?.appId;
      const key = config.github?.privateKey;
      if (!appId || !key) return { ok: false, message: "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are not set" };
      await new HttpGitHubAppAuth({ appId, privateKey: key, installationId: String(installation.installationId), fetch: doFetch }).installationToken();
      return { ok: true, message: "minted an installation token" };
    },
  };
  const gitlab: ConnectionProvider = {
    id: "gitlab",
    label: "GitLab",
    mode: "manual",
    start: ({ webhookUrl }) => ({
      steps: [
        "Create a group access token (or a service account token) with the Owner role and api scope on your top-level group; it maintains the group webhook.",
        "For each factory, create a bot service account with the Developer role on the projects it works on, and store its token as a Kiln secret.",
        `Kiln adds a group webhook to ${webhookUrl.replace(/\/[^/]+$/, "/gitlab")} with a generated secret token (Note, Merge request and Push events).`,
      ],
      fields: [
        { name: "baseUrl", label: "GitLab URL", optional: true, placeholder: "https://gitlab.com" },
        { name: "group", label: "Top-level group path" },
        { name: "token", label: "Manager token", secret: true },
      ],
    }),
    complete: async ({ params }) => {
      const p = need(params, "group", "token");
      const base = (p.baseUrl || "https://gitlab.com").replace(/\/$/, "");
      const g = await jsonRequest<{ id: number; full_path: string; web_url: string } | undefined>("GitLab", doFetch, "GET", `${base}/api/v4/groups/${encodeURIComponent(p.group)}`, { "private-token": p.token });
      if (!g) throw new Error(`GitLab group ${p.group} was not found with this token`);
      return { account: { id: String(g.id), name: g.full_path, url: g.web_url }, scopes: ["api"], installation: { baseUrl: base, group: g.full_path }, secrets: { token: p.token } };
    },
    test: async ({ installation, secrets }) => {
      const me = await jsonRequest<{ username: string } | undefined>("GitLab", doFetch, "GET", `${installation.baseUrl}/api/v4/user`, { "private-token": secrets.token ?? "" });
      return me ? { ok: true, message: `authenticated as ${me.username}` } : { ok: false, message: "token rejected" };
    },
  };
  const azure: ConnectionProvider = {
    id: "azure_devops",
    label: "Azure DevOps",
    mode: "manual",
    start: ({ webhookUrl }) => ({
      steps: [
        "Create an identity for the factory (a service principal with Basic access, or a user) and a personal access token with Code (read & write), Work items (read & write) and Pull request threads.",
        `In Project settings → Service hooks, add Web Hooks subscriptions to ${webhookUrl.replace(/\/[^/]+$/, "/azure-devops")} for pull request created/updated/merged/commented, code pushed and work item created/updated/commented, with basic auth (any user name, the password Kiln shows).`,
      ],
      fields: [
        { name: "organization", label: "Organization" },
        { name: "token", label: "Personal access token", secret: true },
        { name: "identity", label: "Factory identity (display name or email)", optional: true },
      ],
    }),
    complete: async ({ params }) => {
      const p = need(params, "organization", "token");
      const r = await jsonRequest<{ value: { name: string }[] } | undefined>("Azure DevOps", doFetch, "GET", `https://dev.azure.com/${p.organization}/_apis/projects?api-version=7.1`, { authorization: `Basic ${Buffer.from(`:${p.token}`).toString("base64")}` });
      if (!r) throw new Error(`organization ${p.organization} was not found`);
      return { account: { id: p.organization, name: p.organization, url: `https://dev.azure.com/${p.organization}` }, scopes: ["code", "work_items"], installation: { organization: p.organization, identity: p.identity, projects: r.value.length }, secrets: { token: p.token, hookPassword: p.hookPassword ?? "" } };
    },
    test: async ({ installation, secrets }) => {
      const r = await jsonRequest<{ count: number } | undefined>("Azure DevOps", doFetch, "GET", `https://dev.azure.com/${installation.organization}/_apis/projects?api-version=7.1`, { authorization: `Basic ${Buffer.from(`:${secrets.token}`).toString("base64")}` });
      return r ? { ok: true, message: `${r.count} projects visible` } : { ok: false, message: "organization not reachable" };
    },
  };
  const bitbucket: ConnectionProvider = {
    id: "bitbucket",
    label: "Bitbucket Cloud",
    mode: "manual",
    start: ({ webhookUrl }) => ({
      steps: [
        "Create a workspace or repository access token with Repositories: write and Pull requests: write.",
        `Add a webhook to ${webhookUrl.replace(/\/[^/]+$/, "/bitbucket")} with a secret, for Pull request created and Comment created, and Repository push.`,
      ],
      fields: [
        { name: "workspace", label: "Workspace" },
        { name: "token", label: "Access token", secret: true },
      ],
    }),
    complete: async ({ params }) => {
      const p = need(params, "workspace", "token");
      const w = await jsonRequest<{ uuid: string; slug: string; links: { html: { href: string } } } | undefined>("Bitbucket", doFetch, "GET", `https://api.bitbucket.org/2.0/workspaces/${encodeURIComponent(p.workspace)}`, { authorization: `Bearer ${p.token}` });
      if (!w) throw new Error(`workspace ${p.workspace} was not found`);
      return { account: { id: w.uuid, name: w.slug, url: w.links.html.href }, scopes: ["repository:write", "pullrequest:write"], installation: { workspace: w.slug }, secrets: { token: p.token } };
    },
    test: async ({ installation, secrets }) => {
      const w = await jsonRequest<unknown>("Bitbucket", doFetch, "GET", `https://api.bitbucket.org/2.0/workspaces/${installation.workspace}`, { authorization: `Bearer ${secrets.token}` });
      return w ? { ok: true, message: "workspace reachable" } : { ok: false, message: "workspace not reachable" };
    },
  };
  const slack: ConnectionProvider = {
    id: "slack",
    label: "Slack",
    mode: config.slack?.clientId ? "oauth" : "manual",
    start: ({ state, redirectUri, webhookUrl }) => ({
      url: config.slack?.clientId ? slackInstallUrl({ clientId: config.slack.clientId, redirectUri, state }) : undefined,
      steps: [
        "Create a Slack app from the manifest in the docs (or at api.slack.com/apps) with the bot scopes listed there.",
        `Turn on Event Subscriptions with the request URL ${webhookUrl.replace(/\/[^/]+$/, "/slack")} and subscribe to app_mention, message.channels, message.groups, message.im, message.mpim, member_joined_channel, reaction_added and app_home_opened. Enable the Home tab.`,
        config.slack?.clientId ? "Click Add to Slack; a workspace admin approves it if your workspace requires approval." : "Install the app to your workspace and paste the bot token and signing secret.",
      ],
      fields: config.slack?.clientId
        ? undefined
        : [
            { name: "botToken", label: "Bot token (xoxb-…)", secret: true },
            { name: "signingSecret", label: "Signing secret", secret: true },
          ],
    }),
    complete: async ({ code, params, redirectUri }) => {
      if (code && config.slack?.clientId && config.slack.clientSecret) {
        const i = await slackExchangeCode({ clientId: config.slack.clientId, clientSecret: config.slack.clientSecret, code, redirectUri, fetch: doFetch });
        return { account: { id: i.teamId, name: i.teamName }, scopes: i.scopes, installation: { teamId: i.teamId, botUserId: i.botUserId, appId: i.appId }, secrets: { botToken: i.botToken } };
      }
      const p = need(params, "botToken");
      const r = await jsonRequest<{ ok: boolean; team_id: string; team: string; user_id: string; error?: string }>("Slack", doFetch, "POST", "https://slack.com/api/auth.test", { authorization: `Bearer ${p.botToken}` });
      if (!r.ok) throw new Error(`Slack rejected the token: ${r.error}`);
      return { account: { id: r.team_id, name: r.team }, scopes: [], installation: { teamId: r.team_id, botUserId: r.user_id }, secrets: { botToken: p.botToken, ...(p.signingSecret ? { signingSecret: p.signingSecret } : {}) } };
    },
    test: async ({ secrets }) => {
      const r = await jsonRequest<{ ok: boolean; team?: string; error?: string }>("Slack", doFetch, "POST", "https://slack.com/api/auth.test", { authorization: `Bearer ${secrets.botToken}` });
      return r.ok ? { ok: true, message: `connected to ${r.team}` } : { ok: false, message: r.error ?? "token rejected" };
    },
  };
  const teams: ConnectionProvider = {
    id: "microsoft-teams",
    label: "Microsoft Teams",
    mode: "manual",
    start: ({ webhookUrl }) => ({
      steps: [
        "Register a bot in Azure (Azure Bot resource, single or multi tenant) and create a client secret.",
        `Set its messaging endpoint to ${webhookUrl.replace(/\/[^/]+$/, "/teams")} and enable the Microsoft Teams channel.`,
        "Download the app package from Kiln, then in the Teams admin center choose Teams apps → Manage apps → Upload new app, and approve it.",
        "Add the app to each team (Apps → Built for your org), then select teams and at least one standard channel in each factory's settings.",
      ],
      fields: [
        { name: "appId", label: "Bot app (client) id" },
        { name: "appPassword", label: "Client secret", secret: true },
        { name: "tenantId", label: "Tenant id (single-tenant bots)", optional: true },
      ],
    }),
    complete: async ({ params }) => {
      const p = need(params, "appId", "appPassword");
      const tenant = p.tenantId || "botframework.com";
      const res = await doFetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: p.appId, client_secret: p.appPassword, scope: "https://api.botframework.com/.default" }).toString(),
      });
      if (!res.ok) throw new Error(`Microsoft rejected the bot credentials (${res.status})`);
      return { account: { id: p.appId, name: p.name || "Kiln bot" }, scopes: ["bot"], installation: { appId: p.appId, tenantId: p.tenantId }, secrets: { appPassword: p.appPassword } };
    },
    test: async ({ installation, secrets }) => {
      const res = await doFetch(`https://login.microsoftonline.com/${installation.tenantId || "botframework.com"}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: String(installation.appId), client_secret: secrets.appPassword ?? "", scope: "https://api.botframework.com/.default" }).toString(),
      });
      return res.ok ? { ok: true, message: "bot credentials accepted" } : { ok: false, message: `token request failed (${res.status})` };
    },
  };
  const discord: ConnectionProvider = {
    id: "discord",
    label: "Discord",
    mode: "install",
    start: ({ state, webhookUrl }) => ({
      url: config.discord?.applicationId ? discordInstallUrl({ applicationId: config.discord.applicationId, state }) : undefined,
      steps: [
        "Create an application at discord.com/developers, add a bot, and copy the application id, public key and bot token.",
        `Set the Interactions Endpoint URL to ${webhookUrl.replace(/\/[^/]+$/, "/discord")}.`,
        "Paste the credentials here; Kiln registers the /kiln command. Then use the install link to add the bot to your server.",
      ],
      fields: [
        { name: "applicationId", label: "Application id" },
        { name: "publicKey", label: "Public key" },
        { name: "botToken", label: "Bot token", secret: true },
        { name: "guildId", label: "Server id (registers /kiln instantly there)", optional: true },
      ],
    }),
    complete: async ({ params }) => {
      const p = need(params, "applicationId", "publicKey", "botToken");
      const me = await jsonRequest<{ id: string; username: string } | undefined>("Discord", doFetch, "GET", "https://discord.com/api/v10/users/@me", { authorization: `Bot ${p.botToken}` });
      if (!me) throw new Error("Discord rejected the bot token");
      return { account: { id: me.id, name: me.username }, scopes: ["bot", "applications.commands"], installation: { applicationId: p.applicationId, publicKey: p.publicKey, botUserId: me.id, guildId: p.guildId }, secrets: { botToken: p.botToken } };
    },
    test: async ({ secrets }) => {
      const me = await jsonRequest<{ username: string } | undefined>("Discord", doFetch, "GET", "https://discord.com/api/v10/users/@me", { authorization: `Bot ${secrets.botToken}` });
      return me ? { ok: true, message: `bot ${me.username}` } : { ok: false, message: "bot token rejected" };
    },
  };
  const linear: ConnectionProvider = {
    id: "linear",
    label: "Linear",
    mode: "oauth",
    start: ({ state, redirectUri, webhookUrl }) => ({
      url: config.linear?.clientId ? linearAuthorizeUrl({ clientId: config.linear.clientId, redirectUri, state }) : undefined,
      steps: [
        `Create an OAuth application in Linear (Settings → API) with redirect URL ${redirectUri}, enable webhooks to ${webhookUrl.replace(/\/[^/]+$/, "/linear")} for Issues, Comments and Agent session events, and set LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET and LINEAR_WEBHOOK_SECRET.`,
        "Connect once for the workspace; then pick the Linear teams in each factory.",
      ],
    }),
    complete: async ({ code, redirectUri }) => {
      if (!code || !config.linear?.clientId || !config.linear.clientSecret) throw new Error("Linear OAuth is not configured (LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET)");
      const r = await linearExchangeCode({ clientId: config.linear.clientId, clientSecret: config.linear.clientSecret, code, redirectUri, fetch: doFetch });
      return { account: { id: r.organization.id, name: r.organization.name, url: `https://linear.app/${r.organization.urlKey}` }, scopes: r.scopes, installation: { appUserId: r.appUserId, urlKey: r.organization.urlKey }, secrets: { accessToken: r.accessToken } };
    },
    test: async ({ secrets }) => {
      const r = await jsonRequest<{ data?: { viewer: { name: string } } }>("Linear", doFetch, "POST", "https://api.linear.app/graphql", { authorization: `Bearer ${secrets.accessToken}` }, { query: "query { viewer { name } }" });
      return r?.data ? { ok: true, message: `connected as ${r.data.viewer.name}` } : { ok: false, message: "token rejected" };
    },
  };
  const jira: ConnectionProvider = {
    id: "jira",
    label: "Jira Cloud",
    mode: "oauth",
    start: ({ state, redirectUri, webhookUrl }) => ({
      url: config.jira?.clientId ? jiraAuthorizeUrl({ clientId: config.jira.clientId, redirectUri, state }) : undefined,
      steps: [
        `Create an OAuth 2.0 (3LO) app in the Atlassian developer console with callback URL ${redirectUri} and the Jira API scopes read:jira-work, write:jira-work, read:jira-user, manage:jira-webhook; set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.`,
        "A Jira site admin approves the connection. If that's someone else, send them an approval link (it expires in 7 days).",
        `Kiln registers a webhook to ${webhookUrl.replace(/\/[^/]+$/, "/jira")}; each factory then picks its projects.`,
      ],
    }),
    complete: async ({ code, redirectUri }) => {
      if (!code || !config.jira?.clientId || !config.jira.clientSecret) throw new Error("Jira OAuth is not configured (JIRA_CLIENT_ID, JIRA_CLIENT_SECRET)");
      const r = await jiraExchangeCode({ clientId: config.jira.clientId, clientSecret: config.jira.clientSecret, code, redirectUri, fetch: doFetch });
      const site = r.sites[0];
      if (!site) throw new Error("the Atlassian account has no Jira site this app can access");
      return { account: { id: site.id, name: site.name, url: site.url }, scopes: r.scopes, installation: { cloudId: site.id, siteUrl: site.url }, secrets: { accessToken: r.accessToken, ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}) } };
    },
    test: async ({ installation, secrets }) => {
      const me = await jsonRequest<{ displayName: string } | undefined>("Jira", doFetch, "GET", `https://api.atlassian.com/ex/jira/${installation.cloudId}/rest/api/3/myself`, { authorization: `Bearer ${secrets.accessToken}` });
      return me ? { ok: true, message: `connected as ${me.displayName}` } : { ok: false, message: "site not reachable" };
    },
  };
  return { github, gitlab, azure_devops: azure, bitbucket, slack, "microsoft-teams": teams, discord, linear, jira };
}
