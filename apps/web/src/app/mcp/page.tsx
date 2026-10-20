import { Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";

const TOOLS: [string, string, string][] = [
  ["list_factories", "List the factories the token can see", "read"],
  ["send_task", "Send work to a factory's foreman", "send"],
  ["get_task", "Get a task by id or PR/issue URL; start_working=true returns branch and clone URL", "read / send"],
  ["message_foreman", "Message the foreman; answers its open question", "send"],
  ["get_conversation", "The task's conversation", "read"],
  ["complete_task", "Hand a local task back, or confirm it landed", "send / decide:merge"],
  ["get_factory_file_schema", "JSON Schema for a definition file kind", "—"],
  ["validate_factory_files", "Validate a tree; apply=true writes it", "read / definitions:write"],
  ["list_inbox", "Open decisions waiting on people", "read"],
  ["decide_gate", "Approve, reject or answer a gate", "decide:<kind>"],
  ["plan_project", "Goal or PRD to roadmap and tracker issues", "send"],
  ["get_metrics", "PRs, autonomy, cycle time, cost per merged PR by agent", "read"],
  ["query_runs", "Raw runs, scores or work items", "read"],
  ["steer_run", "Steer a running agent", "send"],
];

export default async function Mcp() {
  const integrations = await safe(() => api.integrations(), undefined);
  const url = `${integrations?.publicUrl ?? "http://localhost:4000"}/mcp`;
  const prompt = `Connect to the Kiln MCP server at ${url} using the bearer token in $KILN_TOKEN.
List my factories, then help me send a task to the right one and follow it through the inbox.`;
  return (
    <>
      <PageHeader crumbs={[{ label: "MCPs and apps" }]} />
      <Page narrow>
        <Section title="Kiln MCP" description="Let Claude Code, Codex or any MCP client send work to factories, pull tasks to a local worktree, hand them back and decide gates. Every call uses the caller's token, so per-factory scopes apply.">
          <div className="space-y-3 text-sm">
            <div>
              Endpoint (streamable HTTP): <code>{url}</code>
            </div>
            <div className="font-medium">Claude Code</div>
            <Pre>{`claude mcp add --transport http kiln ${url} --header "Authorization: Bearer $KILN_TOKEN"`}</Pre>
            <div className="font-medium">Codex</div>
            <Pre>{`[mcp_servers.kiln]\nurl = "${url}"\nbearer_token_env_var = "KILN_TOKEN"`}</Pre>
            <div className="font-medium">Agent setup prompt</div>
            <Pre>{prompt}</Pre>
            <p className="text-muted-foreground">Create a token with only the scopes the agent needs under Users, e.g. <code>read:*,send:shop</code>. A product owner&apos;s token like <code>read:shop,decide:spec:shop,decide:preview:shop</code> cannot touch definitions.</p>
          </div>
        </Section>
        <Section title="Tools">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead>What it does</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TOOLS.map(([n, d, s]) => (
                  <TableRow key={n}>
                    <TableCell className="font-mono text-xs">{n}</TableCell>
                    <TableCell className="whitespace-normal">{d}</TableCell>
                    <TableCell className="font-mono text-xs">{s}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      </Page>
    </>
  );
}
