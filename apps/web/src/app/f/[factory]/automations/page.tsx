import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kiln/ui";
import { buttonVariants } from "@/components/ui/button";
import { automationTemplates, lastRuns } from "@/lib/api/automations";
import { automationNames, automationPath, parseAutomation } from "@/lib/automations/model";
import { api, safe } from "@/lib/kiln";
import { cn } from "@/lib/utils";
import { AreaTabs } from "./_components/area-tabs";
import { AutomationsTable, type AutomationRow } from "./_components/automations-table";
import { Suggestions } from "./_components/suggestions";

export const metadata: Metadata = { title: "Automations" };

export default async function Automations({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const [f, def, templates, last] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory), null), automationTemplates(factory), lastRuns(factory)]);
  if (!f) notFound();
  const tree = def?.tree ?? {};
  const fromTree = automationNames(tree);
  const rows: AutomationRow[] = fromTree.length
    ? fromTree.map((name) => {
        let a: ReturnType<typeof parseAutomation> | null = null;
        try {
          a = parseAutomation(name, tree[automationPath(tree, name)!]!);
        } catch {
          /* invalid front matter: show the row with no triggers */
        }
        return { name, title: a?.displayName || name, enabled: a?.enabled ?? true, triggers: a?.triggers ?? [], lastRun: last[name] };
      })
    : f.automations.map((a) => ({ name: a.name, title: a.name, enabled: a.enabled, triggers: a.triggers, lastRun: last[a.name] }));
  return (
    <>
      <PageHeader
        crumbs={[{ label: f.factory.name, href: `/f/${factory}/dashboard` }, { label: "Automations" }]}
        actions={
          <>
            <Link href={`/f/${factory}/webhooks`} className={cn(buttonVariants({ variant: "outline" }))}>
              Manage Webhooks
            </Link>
            <Link href={`/f/${factory}/automations/new`} className={buttonVariants()}>
              New
            </Link>
          </>
        }
      />
      <div className="px-4 py-6 sm:px-6">
        <AreaTabs factory={factory} active="automations" />
        <AutomationsTable factory={factory} rows={rows} />
        <Suggestions factory={factory} templates={templates} />
      </div>
    </>
  );
}
