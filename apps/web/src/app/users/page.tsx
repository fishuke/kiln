import { issueToken } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, Page, PageHeader, Pre, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { timeAgo } from "@/lib/format";

export default async function Users({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const tokens = await safe(() => api.tokens(), null);
  if (!tokens) return <ApiDown />;
  return (
    <>
      <PageHeader crumbs={[{ label: "Users" }]} />
      <Page>
        <p className="mb-6 text-sm text-muted-foreground">People and agents authenticate with tokens whose grants name a scope and a factory. Scopes: read, send, decide:spec, decide:preview, decide:question, decide:merge, definitions:write, admin.</p>
        {token && (
          <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/30">
            New token, shown once:
            <Pre className="mt-2 bg-background">{token}</Pre>
          </div>
        )}
        <Section title="Tokens">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Grants</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}{t.revoked ? " (revoked)" : ""}</TableCell>
                    <TableCell>{t.subject}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        {t.grants.map((g) => (
                          <Badge key={`${g.scope}:${g.factory}`} variant="outline" className="font-mono">
                            {g.scope}:{g.factory}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{timeAgo(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
        <Section title="Issue a token">
          <form action={issueToken} className="grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]">
            <input name="name" required placeholder="Name, e.g. PO laptop" className="h-9 rounded-md border bg-background px-3 text-sm" />
            <input name="subject" required placeholder="email" className="h-9 rounded-md border bg-background px-3 text-sm" />
            <input name="grants" required placeholder="read:shop,decide:spec:shop,decide:preview:shop" className="h-9 rounded-md border bg-background px-3 font-mono text-xs" />
            <SubmitButton>Issue</SubmitButton>
          </form>
        </Section>
      </Page>
    </>
  );
}
