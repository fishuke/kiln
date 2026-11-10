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
      <div className="kiln-hero relative isolate flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
        <div aria-hidden className="kiln-hero-bg">
          <svg className="kiln-hero-logo" viewBox="0 0 32 32" fill="none">
            <defs>
              <linearGradient id="kiln-hero-stroke" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" className="lit" />
                <stop offset="0.55" className="dim" />
              </linearGradient>
              <linearGradient id="kiln-hero-fill" x1="0" y1="0" x2="0.6" y2="1">
                <stop offset="0" className="fill-lit" />
                <stop offset="1" className="fill-dim" />
              </linearGradient>
            </defs>
            <rect x="0.5" y="0.5" width="31" height="31" rx="7" stroke="url(#kiln-hero-stroke)" strokeWidth="0.12" fill="url(#kiln-hero-fill)" />
            <path
              transform="translate(6.4 6.4) scale(1.2)"
              d="M3 13.5 6.2 2.5h2.6L5.6 13.5zM7.4 13.5l3.2-11h2.6l-3.2 11z"
              stroke="url(#kiln-hero-stroke)"
              strokeWidth="0.1"
              fill="url(#kiln-hero-fill)"
            />
          </svg>
          <div className="kiln-hero-logo-fade" />
        </div>
        <h2 className="kiln-hero-title mb-6 text-center text-3xl font-semibold tracking-tight">
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
