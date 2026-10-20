import type { Metadata } from "next";
import { PageHeader } from "@/components/kiln/ui";
import { connections } from "@/lib/api/connections";
import { INTEGRATIONS, integrationState } from "@/lib/integration-catalog";
import { api, safe } from "@/lib/kiln";
import { IntegrationsList, type Row } from "./integrations-list";

export const metadata: Metadata = { title: "Integrations" };

export default async function Integrations() {
  const [conns, legacy, me] = await Promise.all([safe(() => connections(), null), safe(() => api.integrations(), undefined), safe(() => api.me(), null)]);
  const byProvider = new Map((conns ?? []).map((c) => [c.provider, c]));
  const rows: Row[] = INTEGRATIONS.map((spec) => {
    const c = spec.connection ? byProvider.get(spec.connection) : undefined;
    const conn = c?.connection;
    return {
      spec,
      state: integrationState(spec, conn, legacy),
      error: conn?.error,
      account: conn?.account,
      connectedAt: conn?.connectedAt,
      connectedBy: conn?.connectedBy,
      lastTest: conn?.lastTest,
      available: c?.available ?? false,
    };
  });
  const canAdmin = me?.role === "owner" || me?.role === "admin" || Boolean(me?.grants.some((g) => g.scope === "admin" && g.factory === "*"));
  const publicUrl = legacy?.publicUrl ?? process.env.KILN_API_URL ?? "http://localhost:4000";
  return (
    <>
      <PageHeader crumbs={[{ label: "Integrations" }]} />
      <div className="mx-auto w-full max-w-[672px] px-6 py-6">
        <p className="mb-6 text-sm text-muted-foreground">Connect and manage integrations across all factories for this workspace. Each factory then opts in to the ones it uses in its settings.</p>
        <IntegrationsList rows={rows} publicUrl={publicUrl} canAdmin={canAdmin} connectionsApi={conns !== null} />
        {conns === null && (
          <p className="mt-4 text-xs text-muted-foreground">This server does not offer browser connections yet, so status comes from its environment. Open Configure on a provider for the variables and webhook URLs to set.</p>
        )}
      </div>
    </>
  );
}
