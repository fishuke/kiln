import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { PageHeader } from "@/components/kiln/ui";

const ROOT = [process.env.KILN_DOCS_DIR, resolve(process.cwd(), "../../docs/site"), resolve(process.cwd(), "docs/site")].find((d) => d && existsSync(d))!;

type DocPage = { slug: string; title: string; section: string; description: string };

function list(): DocPage[] {
  const out: DocPage[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e.endsWith(".md")) {
        const src = readFileSync(full, "utf8");
        const fm = /^---\n([\s\S]*?)\n---\n/.exec(src)?.[1] ?? "";
        const get = (k: string) => new RegExp(`^${k}: (.*)$`, "m").exec(fm)?.[1]?.trim() ?? "";
        out.push({ slug: relative(ROOT, full).replace(/\.md$/, ""), title: get("title"), section: get("section"), description: get("description") });
      }
    }
  };
  if (ROOT) walk(ROOT);
  return out;
}

export default async function Docs({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const path = (slug ?? ["index"]).join("/");
  if (!ROOT || path.includes("..")) notFound();
  const file = join(ROOT, `${path}.md`);
  if (!existsSync(file)) notFound();
  const src = readFileSync(file, "utf8");
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, "");
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  // Rewrite relative .md links to /docs routes.
  const html = (await marked.parse(body)).replace(/href="(?!https?:|#|\/)([^"]+?)\.md(#[^"]*)?"/g, (_m, target: string, hash = "") => {
    const parts = [...(dir ? dir.split("/") : []), ...target.split("/")];
    const stack: string[] = [];
    for (const p of parts) {
      if (p === "..") stack.pop();
      else if (p !== ".") stack.push(p);
    }
    return `href="/docs/${stack.join("/")}${hash}"`;
  });
  const pages = list();
  const sections = [...new Set(pages.filter((p) => p.slug !== "index").map((p) => p.section))];
  const title = pages.find((p) => p.slug === path)?.title ?? "Docs";
  return (
    <>
      <PageHeader crumbs={[{ label: "Docs", href: "/docs" }, ...(path === "index" ? [] : [{ label: title }])]} />
      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-8">
        <nav className="sticky top-20 hidden max-h-[80vh] w-56 shrink-0 overflow-y-auto text-sm lg:block">
          {sections.map((s) => (
            <div key={s} className="mb-4">
              <div className="mb-1 text-xs font-medium text-muted-foreground">{s}</div>
              {pages
                .filter((p) => p.section === s && p.slug !== "index")
                .map((p) => (
                  <Link key={p.slug} href={`/docs/${p.slug}`} className={`block rounded px-2 py-1 ${p.slug === path ? "bg-muted font-medium" : "hover:bg-muted/50"}`}>
                    {p.title}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <article className="kiln-prose min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  );
}
