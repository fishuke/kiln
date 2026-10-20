import { ApiDown, Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api, safe } from "@/lib/kiln";

export default async function Integrations() {
  const i = await safe(() => api.integrations(), null);
  if (!i) return <ApiDown />;
  const base = i.publicUrl ?? "http://localhost:4000";
  const rows: [string, string, boolean, string][] = [
    ["Code forge", i.forge, i.forge === "github", "Set GITHUB_TOKEN (a GitHub App installation token) and point the app's webhook at /webhooks/github."],
    ["Issue tracker", i.tracker, i.tracker !== "fake", "Set LINEAR_API_KEY and LINEAR_TEAM_ID, or JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY."],
    ["Chat", i.chat, i.chat === "slack", "Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET; subscribe to app_mention and message.channels."],
    ["Previews", i.preview, i.preview !== "fake", "Set VERCEL_TOKEN and VERCEL_PROJECT, or use the Kubernetes namespace provider."],
    ["Typed decisions", `${i.decisions.primary} → ${i.decisions.fallback}`, i.decisions.primary !== "fake", "Set JEV_API_URL and JEV_API_KEY for Jev, and LLM_GATEWAY_URL for the LLM fallback (LiteLLM, Bedrock or Vertex behind it)."],
    ["Agents", i.agents, i.agents !== "scripted", "Set KILN_AGENTS=real to run Claude Code, Codex and OpenCode in sandboxes with your keys."],
    ["Sandboxes", `${i.defaultBackend} (${i.sandboxes.join(", ")})`, i.defaultBackend !== "local", "Set KILN_SANDBOX=docker or kubernetes (gVisor)."],
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: "Integrations" }]} />
      <Page narrow>
        <p className="mb-6 text-sm text-muted-foreground">
          Everything runs locally out of the box: a git-backed forge, an in-process tracker and chat, and scripted agents. Each integration switches on when its credentials are set.
        </p>
        <div className="space-y-3">
          {rows.map(([name, value, connected, how]) => (
            <Card key={name} size="sm">
              <CardContent className="flex items-start gap-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{name}</div>
                  <div className="text-muted-foreground">{how}</div>
                </div>
                <Badge variant={connected ? "secondary" : "outline"}>{connected ? `Connected · ${value}` : `Local · ${value}`}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
        <Section title="Webhook URLs">
          <Pre>{[`GitHub   ${base}/webhooks/github`, `Slack    ${base}/webhooks/slack`, `Linear   ${base}/webhooks/linear`, `Jira     ${base}/webhooks/jira?token=$JIRA_WEBHOOK_TOKEN`, `Custom   ${base}/webhooks/<factory>/<webhook name>`].join("\n")}</Pre>
        </Section>
        <Section title="Talk to a factory from your tools">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Slack: mention <code>@your-factory</code>; reply in the thread to answer questions, or with “approve” to approve a spec or preview.</li>
            <li>Linear and Jira: delegate an issue to the agent or mention the factory alias.</li>
            <li>GitHub: label an issue <code>kiln-ready</code> (or whatever your automation filters on); review comments on a factory PR send it back to implementation.</li>
          </ul>
        </Section>
      </Page>
    </>
  );
}
