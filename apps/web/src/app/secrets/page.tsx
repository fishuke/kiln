import { setSecret } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";

const KEYS: [string, string, string][] = [
  ["CLAUDE_CODE_OAUTH_TOKEN", "Claude Code on your Claude subscription", "Run `claude setup-token` on your machine and paste the token. Claude Code agents use it instead of an API key."],
  ["ANTHROPIC_API_KEY", "Claude Code or OpenCode with an Anthropic API key", "Used when no subscription token is set."],
  ["OPENAI_API_KEY", "Codex and OpenCode", "OpenAI or a compatible gateway key."],
  ["OPENROUTER_API_KEY", "OpenCode through OpenRouter", "Any model OpenRouter serves, including open-weight ones."],
  ["GITHUB_WEBHOOK_SECRET", "GitHub webhook signature", "Set the same value in the GitHub App's webhook settings."],
  ["SLACK_SIGNING_SECRET", "Slack request signatures", "From the Slack app's Basic Information page."],
];

export default async function Secrets() {
  const names = await safe(() => api.secrets(), null);
  if (!names) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Secrets" }]} />
      <Page narrow>
        <Section title="Bring your own keys" description="Kiln is open source and self-hosted: models run on your keys or your subscription. Values stay in the control plane; an agent receives only the secrets its definition lists, plus its harness credential.">
          <ul className="divide-y rounded-xl border text-sm">
            {KEYS.map(([name, what, how]) => (
              <li key={name} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <code>{name}</code>
                    {names.includes(name) ? <Badge variant="secondary">set</Badge> : <Badge variant="outline">not set</Badge>}
                  </div>
                  <div className="mt-0.5 font-medium">{what}</div>
                  <div className="text-muted-foreground">{how}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Use a key for one agent" description="Point an agent's harness at a named secret, for example a team key for the reviewer:">
          <Pre>{`---
agentType: REVIEW
harness:
  type: codex
  auth: { source: secret, secretName: TEAM_OPENAI }
---`}</Pre>
        </Section>
        <Section title="All secrets">
          <ul className="mb-4 flex flex-wrap gap-2">
            {names.map((n) => (
              <li key={n}>
                <Badge variant="outline" className="font-mono">{n}</Badge>
              </li>
            ))}
          </ul>
          <form action={setSecret} className="flex gap-2">
            <input name="name" required placeholder="NAME" pattern="[A-Z0-9_]+" className="h-9 w-56 rounded-md border bg-background px-3 font-mono text-sm" />
            <input name="value" required type="password" placeholder="value" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
            <SubmitButton>Save</SubmitButton>
          </form>
        </Section>
      </Page>
    </>
  );
}
