import { ApiDown, Page, PageHeader } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";

export default async function Audit() {
  const log = await safe(() => api.audit(300), null);
  if (!log) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Audit log" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">Every definition change, decision, token and steering message, newest first.</p>
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{e.at.replace("T", " ").slice(0, 19)}</TableCell>
                  <TableCell className="max-w-48 truncate">{e.actor}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs">{e.target}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Page>
    </>
  );
}
