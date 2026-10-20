import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GitHubOAuthClient, issueToken, type GitHubOAuth } from "@kiln/auth";
import { FakeProvider, JevProvider, LlmProvider, type DecisionProvider } from "@kiln/decide";
import { loadTree } from "@kiln/definitions";
import { DecisionJudge, fakeAgents, FakeJudge, Kiln, sampleTree, type IntegrationAdapters, type KilnOptions } from "@kiln/engine";
import {
  AzureDevOpsForge,
  BitbucketForge,
  connectionProviders,
  DiscordChat,
  FakeChat,
  FakeForge,
  FakePreview,
  FakeTracker,
  GitHubForge,
  GitLabForge,
  HttpGitHubAppAuth,
  HttpJiraCloudApi,
  HttpLinearAgentApi,
  JiraTracker,
  LinearTracker,
  parseSmtpUrl,
  SlackChat,
  SmtpMailer,
  TeamsChat,
  VercelPreview,
  type Forge,
} from "@kiln/integrations";
import { DEFAULT_EGRESS, DockerSandboxProvider, KubernetesSandboxProvider, LocalSandboxProvider } from "@kiln/sandbox";
import { FileObjectStore, FileStore } from "@kiln/store";

export type ServerConfig = {
  kiln: Kiln;
  devAuth: boolean;
  port: number;
  publicUrl: string;
  dataDir: string;
  mode: "local" | "connected";
  adminToken?: string;
  /** GitHub login, when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are set. */
  github?: GitHubOAuth;
  /** KILN_OPEN_SIGNUP=1: anyone may sign up and join the default team. */
  openSignup: boolean;
};

/**
 * Builds Kiln from environment variables. Anything not configured falls back to a local
 * stand-in (git-backed forge, in-process tracker and chat, scripted agents), so `pnpm dev`
 * works with no accounts; each real integration switches on when its credentials are set.
 */
export function kilnFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = resolve(env.KILN_DATA_DIR ?? ".data");
  mkdirSync(dataDir, { recursive: true });
  const port = Number(env.PORT ?? 4000);
  const publicUrl = env.KILN_PUBLIC_URL ?? `http://localhost:${port}`;

  // A GitHub App (installation tokens minted per call) or a plain token; otherwise the local git-backed forge.
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.includes("BEGIN") ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n") : env.GITHUB_APP_PRIVATE_KEY ? Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8") : undefined;
  const appAuth = env.GITHUB_APP_ID && privateKey ? new HttpGitHubAppAuth({ appId: env.GITHUB_APP_ID, privateKey, installationId: env.GITHUB_APP_INSTALLATION_ID }) : undefined;
  const forge: Forge = appAuth ? new GitHubForge({ token: () => appAuth.installationToken() }) : env.GITHUB_TOKEN ? new GitHubForge({ token: env.GITHUB_TOKEN }) : new FakeForge(join(dataDir, "forge"), ["main"], true);
  const tracker = env.LINEAR_API_KEY && env.LINEAR_TEAM_ID
    ? new LinearTracker({ apiKey: env.LINEAR_API_KEY, teamId: env.LINEAR_TEAM_ID })
    : env.JIRA_BASE_URL && env.JIRA_API_TOKEN
      ? new JiraTracker({ baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL ?? "", apiToken: env.JIRA_API_TOKEN, projectKey: env.JIRA_PROJECT_KEY ?? "KIL" })
      : new FakeTracker("linear");
  const chat = env.SLACK_BOT_TOKEN ? new SlackChat({ botToken: env.SLACK_BOT_TOKEN }) : new FakeChat();
  const preview = env.VERCEL_TOKEN && env.VERCEL_PROJECT ? new VercelPreview({ token: env.VERCEL_TOKEN, project: env.VERCEL_PROJECT, teamId: env.VERCEL_TEAM_ID }) : new FakePreview();

  const llm: DecisionProvider | undefined = env.LLM_GATEWAY_URL ? new LlmProvider({ baseUrl: env.LLM_GATEWAY_URL, apiKey: env.LLM_GATEWAY_KEY ?? "", model: env.KILN_DECISION_MODEL ?? "claude-haiku-5-5" }) : undefined;
  const primary: DecisionProvider = env.JEV_API_URL && env.JEV_API_KEY ? new JevProvider({ baseUrl: env.JEV_API_URL, apiKey: env.JEV_API_KEY }) : (llm ?? new FakeProvider());
  const decide = { primary, fallback: llm ?? new FakeProvider() };

  const realAgents = env.KILN_AGENTS === "real";
  const backend = (env.KILN_SANDBOX ?? "local") as "local" | "docker" | "kubernetes";
  const options: KilnOptions = {
    forge,
    tracker,
    chat,
    preview,
    store: new FileStore(join(dataDir, "kiln.json")),
    objects: new FileObjectStore(join(dataDir, "objects")),
    decide,
    judge: realAgents ? new DecisionJudge(primary, llm ? new DecisionJudge(llm) : undefined) : new FakeJudge(({ run }) => (run.status === "succeeded" ? "meets" : "misses")),
    harness: realAgents ? undefined : fakeAgents(),
    sandboxes: {
      local: new LocalSandboxProvider(join(dataDir, "sandboxes")),
      ...(backend === "docker" ? { docker: new DockerSandboxProvider(undefined, { egress: { network: env.KILN_EGRESS_NETWORK || DEFAULT_EGRESS.network, proxy: env.KILN_EGRESS_PROXY || DEFAULT_EGRESS.proxy } }) } : {}),
      ...(backend === "kubernetes" ? { kubernetes: new KubernetesSandboxProvider(undefined, env.KILN_SANDBOX_NAMESPACE) } : {}),
    },
    defaultBackend: backend,
    publicUrl,
    webUrl: env.KILN_WEB_URL ?? "http://localhost:3000",
    roles: parseRoles(env.KILN_ROLES ?? "po=po@kiln.local;code-owners=lead@kiln.local;admins=admin@kiln.local"),
    secretKey: env.KILN_SECRET_KEY,
    storageRoot: join(dataDir, "storage"),
    mailer: env.KILN_SMTP_URL ? new SmtpMailer(parseSmtpUrl(env.KILN_SMTP_URL, env.KILN_MAIL_FROM)) : undefined,
    defaultImage: env.KILN_RUNNER_IMAGE || undefined,
    ownerEmail: env.KILN_OWNER_EMAIL || undefined,
    serverAdmins: (env.KILN_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean),
    forgeToken: env.GITHUB_TOKEN,
    connectionProviders: connectionProviders({
      github: { appSlug: env.GITHUB_APP_SLUG, appId: env.GITHUB_APP_ID, privateKey, clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
      slack: { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET },
      linear: { clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET },
      jira: { clientId: env.JIRA_CLIENT_ID, clientSecret: env.JIRA_CLIENT_SECRET },
      discord: { applicationId: env.DISCORD_APPLICATION_ID },
    }),
    adapters: adaptersFromEnv(env),
  };
  const kiln = new Kiln(options);

  let adminToken: string | undefined;
  const tokenFile = join(dataDir, "admin-token");
  if (kiln.store.list("api_tokens").length === 0) {
    adminToken = issueToken(kiln.store, { name: "bootstrap admin", subject: env.KILN_ADMIN ?? "admin@kiln.local", grants: [{ scope: "admin", factory: "*" }] }).token;
    writeFileSync(tokenFile, `${adminToken}\n`, { mode: 0o600 });
  } else if (existsSync(tokenFile)) {
    adminToken = readFileSync(tokenFile, "utf8").trim();
  }

  // Factories created before teams existed move into the default team.
  kiln.teams.ensureDefaultTeam();
  const github = env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? new GitHubOAuthClient({ clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, baseUrl: env.GITHUB_OAUTH_URL, apiUrl: env.GITHUB_API_URL }) : undefined;

  return { kiln, devAuth: env.KILN_DEV_AUTH === "1", port, publicUrl, dataDir, mode: env.GITHUB_TOKEN || appAuth ? "connected" : "local", adminToken, github, openSignup: env.KILN_OPEN_SIGNUP === "1" };
}

/**
 * Adapters for providers configured by environment variables. Providers connected later through
 * the API are picked up from their stored credentials without a restart.
 */
export function adaptersFromEnv(env: NodeJS.ProcessEnv): IntegrationAdapters {
  const adapters: IntegrationAdapters = { chats: {}, forges: {} };
  if (env.GITLAB_TOKEN) adapters.forges!.gitlab = new GitLabForge({ token: env.GITLAB_TOKEN, baseUrl: env.GITLAB_BASE_URL });
  if (env.AZURE_DEVOPS_ORG && env.AZURE_DEVOPS_TOKEN) adapters.forges!.azure_devops = new AzureDevOpsForge({ organization: env.AZURE_DEVOPS_ORG, token: env.AZURE_DEVOPS_TOKEN });
  if (env.BITBUCKET_TOKEN) adapters.forges!.bitbucket = new BitbucketForge({ token: env.BITBUCKET_TOKEN, username: env.BITBUCKET_USERNAME });
  if (env.TEAMS_APP_ID && env.TEAMS_APP_PASSWORD) adapters.chats!.teams = new TeamsChat({ appId: env.TEAMS_APP_ID, appPassword: env.TEAMS_APP_PASSWORD, tenantId: env.TEAMS_TENANT_ID });
  if (env.DISCORD_BOT_TOKEN) adapters.chats!.discord = new DiscordChat({ botToken: env.DISCORD_BOT_TOKEN, applicationId: env.DISCORD_APPLICATION_ID });
  if (env.LINEAR_ACCESS_TOKEN) adapters.linearAgent = new HttpLinearAgentApi({ token: env.LINEAR_ACCESS_TOKEN });
  if (env.JIRA_CLOUD_ID && env.JIRA_ACCESS_TOKEN) adapters.jira = new HttpJiraCloudApi({ cloudId: env.JIRA_CLOUD_ID, accessToken: env.JIRA_ACCESS_TOKEN });
  return adapters;
}

function parseRoles(spec: string): Record<string, string[]> {
  return Object.fromEntries(
    spec
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const [role, users] = p.split("=");
        return [role!.trim(), (users ?? "").split(",").map((u) => u.trim()).filter(Boolean)];
      }),
  );
}

/**
 * Local demo data: two factories on git-backed repos, a project, and work in every stage, so the
 * dashboard, inbox and PO workspace have something to show on first start.
 */
export async function seedDemo(kiln: Kiln, root: string) {
  if (kiln.defs.list().length > 0 || !(kiln.forge instanceof FakeForge)) return false;
  const forge = kiln.forge;
  const shopFiles = {
    "README.md": "# Shop\n\nThe storefront.\n",
    "package.json": '{ "name": "shop", "private": true }\n',
    "src/cart.ts": "export function total(items: { price: number }[]) {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n",
  };
  forge.createRepo({ owner: "demo", name: "shop" }, shopFiles);
  forge.createRepo({ owner: "demo", name: "api" }, { "README.md": "# API\n", "package.json": '{ "name": "api" }\n' });
  const selfDir = join(root, "factories/templates/sdlc");
  const shopTree = existsSync(join(selfDir, "factory.yaml"))
    ? Object.fromEntries(Object.entries(loadTree(selfDir)).map(([k, v]) => [k, v.replace(/owner: acme, name: web-app/g, "owner: demo, name: shop").replace(/^name: .+$/m, "name: Shop").replace(/^alias: .+$/m, "alias: shop")]))
    : sampleTree({}, "Shop", "shop", "demo/shop");
  forge.createRepo({ owner: "demo", name: "shop-config" }, shopTree);
  await kiln.defs.connectRepo({ owner: "demo", name: "shop-config" }, "demo");
  kiln.defs.apply(sampleTree({ "agents/planner/agent.md": "---\nagentType: PLAN\n---\nPlan roadmaps from PRDs.\n" }, "API", "api", "demo/api"), { author: "demo" });
  const shop = kiln.defs.list().find((f) => f.alias === "shop")?.id ?? "shop";
  const project = kiln.planning.createProject({ name: "Customer portal", owner: "po@kiln.local", factories: [shop, "api"] });

  const send = (factory: string, title: string, body: string, requester = "po@kiln.local") =>
    kiln.workflow.create({ factory, title, body, source: { provider: "kiln" }, requester, projectId: project.id });

  const merged = await send(shop, "Fix typo in checkout button", "The button says 'Chekout'.");
  await kiln.workflow.advance(merged.id);
  const m = kiln.workflow.get(merged.id)!;
  if (m.pr) await forge.merge({ owner: "demo", name: "shop" }, m.pr.number, "lead@kiln.local").then(() => kiln.workflow.onPullRequestMerged(m.pr!.repo, m.pr!.number, "lead@kiln.local"));

  const spec = await send(shop, "Saved carts", "Shoppers can save a cart and come back to it.\n- A signed-in shopper can save the current cart\n- Saved carts appear on the account page\n- A saved cart can be restored with one click");
  await kiln.workflow.advance(spec.id);

  const previewItem = await send(shop, "Show delivery estimate", "- The product page shows an estimated delivery date\n- The estimate uses the shopper's postcode");
  await kiln.workflow.advance(previewItem.id);
  const specGate = kiln.gates.list({ workItemId: previewItem.id, state: "open" }).find((g) => g.kind === "spec");
  if (specGate) {
    await kiln.gates.decide(specGate.id, { decision: "approve", by: "po@kiln.local", via: "web" });
    await kiln.workflow.advance(previewItem.id);
  }

  const handed = await send("api", "Fix rate limit header", "Return Retry-After on 429 responses.", "lead@kiln.local");
  await kiln.workflow.advance(handed.id);

  await kiln.planning.plan(project.id, {
    goal: "Self-serve returns",
    prd: "## Returns\n### Start a return from the order page\n  - AC: a Return button appears on delivered orders\n### Print a return label\n### Refund on receipt\n  - AC: the refund is issued when the parcel is scanned\n",
    by: "po@kiln.local",
  });
  kiln.memories.propose(shop, { title: "Prices are integers in cents", body: "Never use floats for money; format at the edge.", author: "lead@kiln.local" });
  kiln.skills.publish(shop, Object.keys(kiln.defs.current(shop).parsed.skills)[0] ?? "house-style", "platform@kiln.local");
  return true;
}
