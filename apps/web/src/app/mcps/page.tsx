import type { Metadata } from "next";
import { ApiDown } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import { McpPage } from "./mcp-list";

export const metadata: Metadata = { title: "MCPs and apps" };

export default async function Mcps() {
  const [registry, secrets, me, integrations] = await Promise.all([safe(() => api.mcpServers(), null), safe(() => api.managedSecrets(), []), safe(() => api.me(), null), safe(() => api.integrations(), undefined)]);
  if (!registry) return <ApiDown />;
  const canEdit = me?.role === "owner" || me?.role === "admin";
  const url = `${integrations?.publicUrl ?? process.env.KILN_API_URL ?? "http://localhost:4000"}/mcp`;
  return <McpPage servers={registry.servers} builtins={registry.builtins} secrets={[...new Set(secrets.map((s) => s.name))]} mcpUrl={url} canEdit={canEdit} />;
}
