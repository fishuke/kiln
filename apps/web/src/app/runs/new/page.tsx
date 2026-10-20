import type { Metadata } from "next";
import Link from "next/link";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import { greeting } from "@/lib/format";
import { NewRunComposer } from "./composer";

export const metadata: Metadata = { title: "New Run" };

type Me = { subject: string; name?: string; user?: { name?: string } };

export default async function NewRun({ searchParams }: { searchParams: Promise<{ factory?: string }> }) {
  const { factory: chosen } = await searchParams;
  const [factories, me] = await Promise.all([safe(() => api.factories(), null), safe(() => api.me() as Promise<Me>, undefined)]);
  if (!factories) return <ApiDown />;
  const full = me?.user?.name ?? me?.name ?? me?.subject.split("@")[0] ?? "";
  const first = full.split(/[\s._-]+/)[0] ?? "";
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
  const current = factories.find((f) => f.id === chosen || f.alias === chosen) ?? factories[0];
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader crumbs={[{ label: "Runs", href: "/runs" }, { label: "New run" }]} />
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
        <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight">
          {greeting()}, {name}
        </h2>
        {factories.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Create a factory first.{" "}
            <Link className="font-medium text-foreground underline" href="/create">
              Create a factory
            </Link>
          </p>
        ) : (
          <NewRunComposer factories={factories.map((f) => ({ id: f.id, name: f.name, alias: f.alias }))} initialFactory={current!.id} />
        )}
      </div>
    </div>
  );
}
