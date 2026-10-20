import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { EmptyPanel } from "@/components/kiln/settings-blocks";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { secretType } from "@/lib/secret-types";
import { EmptyActions, SecretRowMenu, SecretsToolbar } from "./toolbar";

export const metadata: Metadata = { title: "Secrets" };

function ago(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function Secrets({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; scope?: string; creator?: string }> }) {
  const sp = await searchParams;
  const [secrets, me] = await Promise.all([safe(() => api.managedSecrets(), null), safe(() => api.me(), null)]);
  if (!secrets) return <ApiDown />;
  const canTeam = me?.role === "owner" || me?.role === "admin";
  const q = sp.q?.toLowerCase().trim();
  const shown = secrets
    .filter((s) => !sp.type || s.type === sp.type)
    .filter((s) => !sp.scope || s.scope === sp.scope)
    .filter((s) => !sp.creator || s.createdBy === sp.creator)
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  const creators = [...new Set(secrets.map((s) => s.createdBy))].sort();

  return (
    <>
      <PageHeader crumbs={[{ label: "Secrets" }]} actions={<SecretsToolbar creators={creators} canTeam={canTeam} />} />
      {secrets.length === 0 ? (
        <EmptyPanel title="You haven’t added any secrets yet." actions={<EmptyActions canTeam={canTeam} />}>
          Secrets allow agents to access accounts and use personal tokens on your behalf.
        </EmptyPanel>
      ) : shown.length === 0 ? (
        <EmptyPanel title="No secrets match these filters.">
          <Link href="/secrets" className="font-medium text-foreground underline-offset-4 hover:underline">
            Clear filters
          </Link>
        </EmptyPanel>
      ) : (
        <div className="px-6 py-4">
          <ul className="divide-y rounded-xl border">
            {shown.map((s) => {
              const meta = secretType(s.type);
              const editable = s.scope === "personal" || canTeam;
              return (
                <li key={s.id} className="group flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <KeyRound className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {editable ? (
                        <Link href={`/secrets/${s.scope}/${encodeURIComponent(s.name)}`} className="truncate font-mono text-sm font-medium hover:underline">
                          {s.name}
                        </Link>
                      ) : (
                        <span className="truncate font-mono text-sm font-medium">{s.name}</span>
                      )}
                      <Badge variant="outline">{meta.label}</Badge>
                      <Badge variant={s.scope === "team" ? "secondary" : "outline"} className="capitalize">
                        {s.scope}
                      </Badge>
                    </div>
                    {s.description && <div className="truncate text-sm text-muted-foreground">{s.description}</div>}
                  </div>
                  <div className="hidden w-56 shrink-0 text-right text-xs text-muted-foreground md:block">
                    <div className="truncate">Updated {ago(s.updatedAt)}</div>
                    <div className="truncate">by {s.updatedBy}</div>
                  </div>
                  <SecretRowMenu scope={s.scope} name={s.name} canEdit={editable} />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {shown.length} of {secrets.length} secret{secrets.length === 1 ? "" : "s"}. Values are write-only and never shown.
          </p>
        </div>
      )}
    </>
  );
}
