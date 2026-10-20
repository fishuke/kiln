/** The providers on the Integrations page: copy, the connection id, and how self-hosters configure each. */

export type IntegrationSpec = {
  id: string;
  /** Provider id in the connections API; absent for providers configured another way. */
  connection?: string;
  name: string;
  description: string;
  kind: "forge" | "chat" | "tracker" | "alerts" | "previews";
  /** Server environment variables, from docs/site/integrations. */
  env: { name: string; note?: string }[];
  /** Webhook path on the API, when the provider sends events. */
  webhook?: string;
  /** Events to subscribe to. */
  events?: string;
  oauthCallback?: boolean;
  docs?: string;
};

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    id: "github",
    connection: "github",
    name: "GitHub",
    description: "Tag agents in PR comments or use them for review.",
    kind: "forge",
    env: [
      { name: "GITHUB_APP_ID" },
      { name: "GITHUB_APP_PRIVATE_KEY" },
      { name: "GITHUB_APP_INSTALLATION_ID" },
      { name: "GITHUB_APP_SLUG" },
      { name: "GITHUB_WEBHOOK_SECRET" },
      { name: "GITHUB_TOKEN", note: "instead of a GitHub App" },
      { name: "GITHUB_CLIENT_ID", note: "GitHub login and account linking" },
      { name: "GITHUB_CLIENT_SECRET" },
    ],
    webhook: "/webhooks/github",
    events: "Issues, Issue comments, Pull requests, Pull request reviews, Check suites, Pushes",
    oauthCallback: true,
    docs: "integrations/github",
  },
  {
    id: "gitlab",
    connection: "gitlab",
    name: "GitLab",
    description: "Tag agents in MR comments or use them for review.",
    kind: "forge",
    env: [{ name: "GITLAB_TOKEN" }, { name: "GITLAB_BASE_URL", note: "self-managed GitLab" }, { name: "GITLAB_WEBHOOK_TOKEN" }, { name: "GITLAB_BOT_USERNAMES" }],
    webhook: "/webhooks/gitlab",
    events: "Merge request, Note (comments), Push",
    docs: "integrations/gitlab",
  },
  {
    id: "azure_devops",
    connection: "azure_devops",
    name: "Azure DevOps",
    description: "Let factories pick up work items and review pull requests in an organization.",
    kind: "forge",
    env: [{ name: "AZURE_DEVOPS_ORG" }, { name: "AZURE_DEVOPS_TOKEN" }, { name: "AZURE_DEVOPS_WEBHOOK_USER" }, { name: "AZURE_DEVOPS_WEBHOOK_PASSWORD" }, { name: "AZURE_DEVOPS_IDENTITIES" }],
    webhook: "/webhooks/azure-devops",
    events: "Work item created and updated, Pull request created, updated and commented",
    docs: "integrations/azure-devops",
  },
  {
    id: "bitbucket",
    connection: "bitbucket",
    name: "Bitbucket",
    description: "Tag agents in pull request comments or use them for review.",
    kind: "forge",
    env: [{ name: "BITBUCKET_TOKEN" }, { name: "BITBUCKET_USERNAME" }, { name: "BITBUCKET_WEBHOOK_SECRET" }, { name: "BITBUCKET_BOT_ACCOUNTS" }],
    webhook: "/webhooks/bitbucket",
    events: "Pull request created, updated and commented, Repository push",
    docs: "integrations/bitbucket",
  },
  {
    id: "slack",
    connection: "slack",
    name: "Slack",
    description: "Interact with your factory directly via @-mention.",
    kind: "chat",
    env: [{ name: "SLACK_BOT_TOKEN" }, { name: "SLACK_SIGNING_SECRET" }, { name: "SLACK_CLIENT_ID", note: "Add to Slack" }, { name: "SLACK_CLIENT_SECRET" }, { name: "KILN_FACTORY_AVATAR_URL" }],
    webhook: "/webhooks/slack",
    events: "app_mention, message.channels, message.im, reaction_added",
    oauthCallback: true,
    docs: "integrations/slack",
  },
  {
    id: "microsoft-teams",
    connection: "microsoft-teams",
    name: "Microsoft Teams",
    description: "Interact with your factory via @-mention in standard and shared channels.",
    kind: "chat",
    env: [{ name: "TEAMS_APP_ID" }, { name: "TEAMS_APP_PASSWORD" }, { name: "TEAMS_TENANT_ID" }],
    webhook: "/webhooks/teams",
    events: "Bot messaging endpoint",
    docs: "integrations/microsoft-teams",
  },
  {
    id: "discord",
    connection: "discord",
    name: "Discord",
    description: "Send work with /kiln and follow it in threads.",
    kind: "chat",
    env: [{ name: "DISCORD_APPLICATION_ID" }, { name: "DISCORD_PUBLIC_KEY" }, { name: "DISCORD_BOT_TOKEN" }, { name: "DISCORD_EVENTS_TOKEN" }, { name: "DISCORD_BOT_USER_ID" }],
    webhook: "/webhooks/discord",
    events: "Interactions endpoint URL",
    oauthCallback: true,
    docs: "integrations/discord",
  },
  {
    id: "linear",
    connection: "linear",
    name: "Linear",
    description: "Bring issues into your factory via @-mention or label.",
    kind: "tracker",
    env: [{ name: "LINEAR_CLIENT_ID" }, { name: "LINEAR_CLIENT_SECRET" }, { name: "LINEAR_WEBHOOK_SECRET" }, { name: "LINEAR_ACCESS_TOKEN" }, { name: "LINEAR_API_KEY", note: "older single-key setup" }],
    webhook: "/webhooks/linear",
    events: "Issues, Comments, Agent session events",
    oauthCallback: true,
    docs: "integrations/linear",
  },
  {
    id: "jira",
    connection: "jira",
    name: "Jira",
    description: "Bring issues into your factory via @-mention or label.",
    kind: "tracker",
    env: [{ name: "JIRA_CLIENT_ID" }, { name: "JIRA_CLIENT_SECRET" }, { name: "JIRA_WEBHOOK_TOKEN" }, { name: "JIRA_BOT_ACCOUNT_ID" }, { name: "JIRA_CLOUD_ID" }, { name: "JIRA_ACCESS_TOKEN" }],
    webhook: "/webhooks/jira?token=$JIRA_WEBHOOK_TOKEN",
    events: "Issue created, Issue updated, Comment created",
    oauthCallback: true,
    docs: "integrations/jira",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Start incident work when Sentry raises an issue or alert.",
    kind: "alerts",
    env: [{ name: "SENTRY_WEBHOOK_SECRET", note: "as a Kiln secret, named by the webhook" }],
    webhook: "/webhooks/<factory>/<webhook name>",
    events: "Issue alerts and metric alerts (internal integration webhook)",
    docs: "integrations/custom-webhooks",
  },
  {
    id: "pagerduty",
    name: "PagerDuty",
    description: "Start incident work when an incident triggers.",
    kind: "alerts",
    env: [{ name: "PAGERDUTY_WEBHOOK_SECRET", note: "as a Kiln secret, named by the webhook" }],
    webhook: "/webhooks/<factory>/<webhook name>",
    events: "incident.triggered (Generic Webhooks v3)",
    docs: "integrations/custom-webhooks",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deploy each factory pull request to a preview people can accept.",
    kind: "previews",
    env: [{ name: "VERCEL_TOKEN" }, { name: "VERCEL_PROJECT" }, { name: "VERCEL_TEAM_ID", note: "optional" }],
    docs: "integrations/previews",
  },
];

export type IntegrationState = "connected" | "pending" | "error" | "env" | "off";

/** What the page shows for a provider, from the connections API, or the older /integrations summary as a fallback. */
export function integrationState(
  spec: IntegrationSpec,
  conn: { status: string; error?: string } | undefined,
  legacy: { forge: string; tracker: string; chat: string; preview: string } | undefined,
): IntegrationState {
  if (conn) return conn.status === "connected" ? "connected" : conn.status === "pending_approval" ? "pending" : "error";
  if (!legacy) return "off";
  if (spec.id === "github" && legacy.forge === "github") return "env";
  if (spec.id === "slack" && legacy.chat === "slack") return "env";
  if (spec.id === "vercel" && legacy.preview === "vercel") return "env";
  return "off";
}

/** Absolute webhook URL on the API. */
export function webhookUrl(publicUrl: string, path: string): string {
  return `${publicUrl.replace(/\/$/, "")}${path}`;
}
