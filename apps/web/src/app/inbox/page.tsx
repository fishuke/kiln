import Link from "next/link";
import { AutoRefresh } from "@/components/kiln/auto-refresh";
import { ApiDown, Empty, Page, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { timeAgo } from "@/lib/format";

const KIND: Record<string, string> = { spec: "Spec approval", preview: "Preview", question: "Question", merge: "Merge", custom: "Approval" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const { mine } = await searchParams;
  const [items, me, digest] = await Promise.all([safe(() => api.inbox(mine ? {} : { all: true }), null), safe(() => api.me(), undefined), safe(() => api.digest(), [])]);
  if (!items) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Inbox" }]} actions={<Link className="text-sm" href={mine ? "/inbox" : "/inbox?mine=1"}>{mine ? "Show everyone's" : "Only mine"}</Link>} />
      <AutoRefresh ms={5000} />
      <Page narrow>
        <p className="mb-6 text-sm text-muted-foreground">Decisions the factories are waiting on, most urgent first. The same decisions can be made from Slack, Linear, the CLI or the Kiln MCP.</p>
        {items.length === 0 ? (
          <Empty title="Nothing is waiting on you">Spec approvals, questions, previews and merges appear here.</Empty>
        ) : (
          <ul className="divide-y rounded-xl border">
            {items.map((g) => (
              <li key={g.id}>
                <Link href={`/inbox/${g.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50">
                  <Badge variant={g.kind === "question" ? "default" : "secondary"} className="mt-0.5 shrink-0">
                    {KIND[g.kind] ?? g.kind}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{g.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {g.factory} · {g.assignees.join(", ") || "anyone"} · {timeAgo(g.openedAt)}
                      {g.nudges ? ` · nudged ${g.nudges}×` : ""}
                    </div>
                  </div>
                  {g.urgency !== undefined && g.urgency >= 0.8 && <span className="text-xs font-medium text-amber-700">urgent</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {digest.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-2 text-sm font-semibold">Weekly digest</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {digest.map((d) => (
                <li key={d.person}>
                  <span className={d.person === me?.subject ? "font-medium text-foreground" : ""}>{d.person}</span>: {d.items.length} decision{d.items.length === 1 ? "" : "s"} waiting, oldest {Math.max(...d.items.map((i) => i.ageHours))}h
                </li>
              ))}
            </ul>
          </div>
        )}
      </Page>
    </>
  );
}
