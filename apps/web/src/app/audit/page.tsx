import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EmptyIcon } from "@/components/kiln/settings-blocks";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/format";
import { api, safe } from "@/lib/kiln";
import { cn } from "@/lib/utils";
import { AuditSearch } from "./search";

export const metadata: Metadata = { title: "Audit log" };

const AREAS = ["definition", "gate", "token", "user", "team", "secret", "mcp", "environment", "run"] as const;

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; area?: string }> }) {
  const sp = await searchParams;
  const log = await safe(() => api.audit(500), null);
  if (!log) return <ApiDown />;
  const q = sp.q?.toLowerCase().trim();
  const shown = log.filter((e) => (!sp.area || e.action.startsWith(sp.area)) && (!q || `${e.actor} ${e.action} ${e.target}`.toLowerCase().includes(q)));
  const now = Date.now();
  return (
    <>
      <PageHeader crumbs={[{ label: "Audit log" }]} actions={<AuditSearch />} />
      <div className="px-6 py-4">
        <nav className="mb-4 flex flex-wrap gap-1.5 text-sm" aria-label="Filter by area">
          {[undefined, ...AREAS].map((a) => (
            <Link
              key={a ?? "all"}
              href={`/audit${a || sp.q ? `?${new URLSearchParams({ ...(a ? { area: a } : {}), ...(sp.q ? { q: sp.q } : {}) })}` : ""}`}
              className={cn("rounded-full border px-2.5 py-0.5 capitalize text-muted-foreground hover:text-foreground", sp.area === a && "border-foreground bg-muted font-medium text-foreground")}
            >
              {a ?? "All"}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <EmptyIcon icon={<ScrollText className="size-4" />} title={log.length ? "No entries match" : "Nothing recorded yet"}>
            Definition changes, decisions, keys, members, secrets and steering messages show up here.
          </EmptyIcon>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36 pl-4">When</TableHead>
                  <TableHead className="w-56">Actor</TableHead>
                  <TableHead className="w-56">Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-4 text-muted-foreground tabular-nums" title={new Date(e.at).toLocaleString()}>
                      {timeAgo(e.at, now)}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{e.actor}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{e.action}</code>
                    </TableCell>
                    <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">{e.target}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {shown.length} of {log.length} most recent entries.
        </p>
      </div>
    </>
  );
}
