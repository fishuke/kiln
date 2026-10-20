import type { Metadata } from "next";
import { AuthShell } from "@/components/kiln/auth-shell";
import { api, errorMessage } from "@/lib/kiln";
import { ConsentButtons } from "./consent-buttons";

export const metadata: Metadata = { title: "Allow access" };

/** An MCP client (Claude Code, Codex, an IDE) asks to use Kiln as the signed-in person. */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const [me, client] = await Promise.all([api.me().catch(() => null), api.request<{ client_name: string; redirect_uris: string[] }>("GET", `/api/v1/oauth/clients/${encodeURIComponent(params.client_id ?? "")}`).catch((e: unknown) => ({ error: errorMessage(e) }))]);
  if ("error" in client) {
    return (
      <AuthShell title="This link does not work" subtitle={client.error}>
        <p className="text-sm text-muted-foreground">Start the connection again from your MCP client.</p>
      </AuthShell>
    );
  }
  const host = (() => {
    try {
      return new URL(params.redirect_uri ?? "").host;
    } catch {
      return params.redirect_uri;
    }
  })();
  return (
    <AuthShell title={`Allow ${client.client_name} to use Kiln?`} subtitle={`It will act as ${me?.user?.email ?? me?.subject ?? "you"} in your teams: read factories, runs and inbox, start and steer work, and answer for you where you can.`}>
      <ul className="mb-5 space-y-1 text-sm text-muted-foreground">
        <li>
          Returns to <code className="font-mono text-xs text-foreground">{host}</code>
        </li>
        <li>Kiln records the approval in the audit log. Logging out of Kiln does not end this connection.</li>
      </ul>
      <ConsentButtons params={params} />
    </AuthShell>
  );
}
