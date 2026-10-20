import Link from "next/link";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { ApiDown, Empty, Page, PageHeader, StateBadge } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { stateLabel, timeAgo, usd } from "@/lib/format";

const FILTERS = ["all", "active", "waiting", "complete", "blocked"] as const;

export default async function Runs({ searchParams }: { searchParams: Promise<{ factory?: string; filter?: string; q?: string }> }) {
  const sp = await searchParams;
  const items = await safe(() => api.workItems({ factory: sp.factory }), null);
  if (!items) return <ApiDown />;
  const filter = (sp.filter ?? "all") as (typeof FILTERS)[number];
  const q = (sp.q ?? "").toLowerCase();
  const shown = items.filter((w) => {
    if (q && !`${w.title} ${w.id}`.toLowerCase().includes(q)) return false;
    if (filter === "active") return !["complete", "cancelled", "failed"].includes(w.state);
    if (filter === "waiting") return ["awaiting_spec", "awaiting_preview", "handed_off"].includes(w.state);
    if (filter === "complete") return w.state === "complete";
    if (filter === "blocked") return ["blocked", "failed"].includes(w.state);
    return true;
  });
  const live = items.some((w) => ["received", "triaging", "planning", "building", "reviewing"].includes(w.state));
  return (
    <>
      <PageHeader crumbs={[{ label: "Runs" }]} actions={<Link href="/" className="text-sm font-medium">New run</Link>} />
      <AutoRefresh enabled={live} />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Link key={f} href={`/runs?filter=${f}${sp.factory ? `&factory=${sp.factory}` : ""}`} className={`rounded-full border px-3 py-1 text-sm capitalize ${filter === f ? "bg-foreground text-background" : "hover:bg-muted"}`}>
              {f}
            </Link>
          ))}
          <form className="ml-auto">
            <input name="q" defaultValue={sp.q} placeholder="Search runs" className="h-8 w-56 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
          </form>
        </div>
        {shown.length === 0 ? (
          <Empty title="No runs here">Send work from the composer, Slack, Linear, Jira, GitHub or the Kiln MCP.</Empty>
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Work item</TableHead>
                  <TableHead>Factory</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="max-w-md">
                      <Link href={`/runs/${w.id}`} className="block truncate font-medium hover:underline">
                        {w.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {w.id}
                        {w.blockedReason ? ` · ${w.blockedReason}` : w.stage ? ` · ${w.stage}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/f/${w.factory}`} className="hover:underline">
                        {w.factory}
                      </Link>
                    </TableCell>
                    <TableCell title={stateLabel(w.state)}>
                      <StateBadge state={w.state} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{w.source.provider}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(w.costUsd)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{timeAgo(w.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Page>
    </>
  );
}
