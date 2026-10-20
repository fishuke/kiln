import Link from "next/link";
import { notFound } from "next/navigation";
import { File, Folder } from "lucide-react";
import { Page, PageHeader, Pre } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";

export default async function Definition({ params, searchParams }: { params: Promise<{ factory: string }>; searchParams: Promise<{ file?: string; sha?: string }> }) {
  const { factory } = await params;
  const sp = await searchParams;
  const [f, def] = await Promise.all([safe(() => api.factory(factory), null), safe(() => api.definition(factory, sp.sha), null)]);
  if (!f || !def) notFound();
  const files = Object.keys(def.tree).sort((a, b) => (a === "factory.yaml" ? -1 : b === "factory.yaml" ? 1 : a.localeCompare(b)));
  const current = sp.file && def.tree[sp.file] !== undefined ? sp.file : "factory.yaml";
  const groups = files.reduce<Record<string, string[]>>((acc, p) => {
    const dir = p.includes("/") ? p.split("/")[0]! : "";
    (acc[dir] ??= []).push(p);
    return acc;
  }, {});
  const repo = f.factory.definitionRepo;
  return (
    <>
      <PageHeader crumbs={[{ label: f.factory.name, href: `/f/${factory}` }, { label: "Factory definition" }]} />
      <Page>
        <p className="mb-4 text-sm text-muted-foreground">
          {repo ? (
            <>
              Stored in the config repo <code>{repo.owner}/{repo.name}</code>{repo.dir ? ` under ${repo.dir}/` : ""}. Merges to <code>{repo.ref}</code> are validated and applied as one unit; an invalid tree is rejected and the last valid one stays active.
            </>
          ) : (
            <>Managed by Kiln. Move it to a GitHub config repo from Settings, or edit it with <code>kiln apply</code>.</>
          )}{" "}
          Showing <code>{def.sha.slice(0, 12)}</code>
          {def.previousSha && (
            <>
              {" "}
              (previous: <Link className="underline" href={`?sha=${def.previousSha}`}>{def.previousSha.slice(0, 10)}</Link>)
            </>
          )}
          .
        </p>
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <nav className="max-h-[70vh] overflow-y-auto rounded-xl border p-2 text-sm">
            {Object.entries(groups).map(([dir, paths]) => (
              <div key={dir} className="mb-2">
                {dir && (
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                    <Folder className="size-3.5" /> {dir}/
                  </div>
                )}
                {paths.map((p) => (
                  <Link key={p} href={`?file=${encodeURIComponent(p)}${sp.sha ? `&sha=${sp.sha}` : ""}`} className={`flex items-center gap-1.5 truncate rounded px-2 py-1 ${p === current ? "bg-muted font-medium" : "hover:bg-muted/50"}`}>
                    <File className="size-3.5 shrink-0" />
                    <span className="truncate">{dir ? p.slice(dir.length + 1) : p}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div>
            <div className="mb-2 font-mono text-xs text-muted-foreground">{current}</div>
            <Pre className="min-h-[50vh]">{def.tree[current]}</Pre>
          </div>
        </div>
      </Page>
    </>
  );
}
