import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, KeyRound, Terminal } from "lucide-react";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { EmptyPanel } from "@/components/kiln/settings-blocks";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { buttonVariants } from "@/components/ui/button";
import { api, safe } from "@/lib/kiln";
import { EnvironmentSearch } from "./search";

export const metadata: Metadata = { title: "Environments" };

export default async function Environments({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [envs, me] = await Promise.all([safe(() => api.environments(), null), safe(() => api.me(), null)]);
  if (!envs) return <ApiDown />;
  const canEdit = me?.role === "owner" || me?.role === "admin";
  const query = q?.toLowerCase().trim();
  const shown = envs.filter((e) => !query || e.name.toLowerCase().includes(query) || e.image?.toLowerCase().includes(query) || e.description?.toLowerCase().includes(query));
  const newButton = canEdit ? (
    <Link href="/environments/new" className={buttonVariants({ className: "h-8 px-3" })}>
      New
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Environments" }]}
        actions={
          <>
            {envs.length > 0 && <EnvironmentSearch />}
            {newButton}
          </>
        }
      />
      {envs.length === 0 ? (
        <EmptyPanel
          title="You haven’t added any environments yet."
          actions={
            canEdit ? (
              <Link href="/environments/new" className={buttonVariants({ className: "h-8 px-3" })}>
                New environment
              </Link>
            ) : undefined
          }
        >
          Environments are templates runs start from: a Docker image, repositories, setup commands and secrets.
        </EmptyPanel>
      ) : shown.length === 0 ? (
        <EmptyPanel title="No environments match your search." />
      ) : (
        <div className="px-6 py-4">
          <ul className="divide-y rounded-xl border">
            {shown.map((e) => (
              <li key={e.id}>
                <Link href={`/environments/${e.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Boxes className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{e.name}</span>
                      {e.image && <span className="truncate font-mono text-xs text-muted-foreground">{e.image}</span>}
                    </div>
                    {e.description && <div className="truncate text-sm text-muted-foreground">{e.description}</div>}
                  </div>
                  <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground md:flex">
                    <span className="flex items-center gap-1" title="Repositories">
                      <GitHubIcon className="size-3.5" /> {e.repos.length}
                    </span>
                    <span className="flex items-center gap-1" title="Setup commands">
                      <Terminal className="size-3.5" /> {e.setupCommands.length}
                    </span>
                    <span className="flex items-center gap-1" title="Secrets">
                      <KeyRound className="size-3.5" /> {e.secrets.length}
                    </span>
                    <span className="w-28 text-right">Updated {new Date(e.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
