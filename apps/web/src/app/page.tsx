import Link from "next/link";
import { ArrowUp, Info, Plus } from "lucide-react";
import { sendTask } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { ApiDown, PageHeader, StateBadge } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import { greeting, timeAgo } from "@/lib/format";

export default async function NewRun({ searchParams }: { searchParams: Promise<{ factory?: string }> }) {
  const { factory: chosen } = await searchParams;
  const [factories, me, recent] = await Promise.all([safe(() => api.factories(), null), safe(() => api.me(), undefined), safe(() => api.workItems(), [])]);
  if (!factories) return <ApiDown />;
  const name = me?.subject.split("@")[0]?.split(/[._-]/)[0] ?? "there";
  const current = factories.find((f) => f.id === chosen) ?? factories[0];
  return (
    <>
      <PageHeader crumbs={[{ label: "Runs", href: "/runs" }, { label: "New run" }]} />
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-[18vh]">
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">
          {greeting()}, {name.charAt(0).toUpperCase() + name.slice(1)}
        </h1>
        {factories.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">
            Create a factory first. <Link className="font-medium text-foreground underline" href="/factories/new">Create a factory</Link>
          </div>
        ) : (
          <form action={sendTask} className="w-full rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
            <textarea
              name="text"
              required
              rows={4}
              placeholder={`Tell me what you'd like to build in ${current?.name ?? "your factory"}...`}
              className="w-full resize-none rounded-t-2xl bg-transparent px-5 pt-4 text-base outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              <span className="flex size-8 items-center justify-center rounded-lg border text-muted-foreground" title="Attachments go in the description">
                <Plus className="size-4" />
              </span>
              <select name="factory" defaultValue={current?.id} className="h-8 rounded-md bg-transparent px-1 text-sm font-medium outline-none">
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <div className="ml-auto">
                <SubmitButton size="icon" variant="secondary">
                  <ArrowUp className="size-4" />
                </SubmitButton>
              </div>
            </div>
          </form>
        )}
        <div className="mt-4 flex w-full items-center gap-1.5 px-1 text-sm text-muted-foreground">
          How to chat with the factory foreman in your connected apps
          <Link href="/integrations" aria-label="Integrations" className="hover:text-foreground">
            <Info className="size-4" />
          </Link>
        </div>
        {recent.length > 0 && (
          <div className="mt-16 w-full">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Recent</div>
            <ul className="divide-y rounded-xl border">
              {recent.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <Link href={`/runs/${w.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                    <span className="truncate">{w.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{w.factory} · {timeAgo(w.updatedAt)}</span>
                    <StateBadge state={w.state} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
