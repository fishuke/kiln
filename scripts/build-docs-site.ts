// pnpm docs:site — builds docs/site/**/*.md into static pages under website/docs/ for the public website.
// Pretty URLs (/docs/configuration/agents/), a section sidebar in the index's order, an on-this-page TOC,
// highlighted code, previous/next links and a client-side search index. Fails on a broken link between docs pages.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Tokens } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs/site");
const OUT = join(ROOT, "website/docs");
const ASSETS = join(ROOT, "scripts/docs-site");
export const REPO_BLOB = "https://github.com/fishuke/kiln/blob/main";
export const REPO_TREE = "https://github.com/fishuke/kiln/tree/main";

export type Heading = { depth: number; id: string; text: string };
export type Page = { file: string; url: string; title: string; description: string; section: string; body: string; headings: Heading[]; html: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** configuration/agents.md → /docs/configuration/agents/ ; index.md → /docs/ */
export function pageUrl(file: string): string {
  const p = file.replace(/\.md$/, "");
  return p === "index" ? "/docs/" : `/docs/${p.replace(/\/index$/, "")}/`;
}

/** Rewrites a link found in `fromFile` (relative to docs/site). Docs pages become /docs URLs; other repository files go to GitHub. */
export function rewriteHref(href: string, fromFile: string, known: Set<string>): { href: string; broken?: boolean } {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return { href };
  const [path = "", hash] = href.split("#") as [string, string | undefined];
  const suffix = hash ? `#${hash}` : "";
  if (path.startsWith("/")) return { href };
  const target = posix.normalize(posix.join(posix.dirname(fromFile), path));
  if (!target.startsWith("../")) {
    if (target.endsWith(".md")) return known.has(target) ? { href: pageUrl(target) + suffix } : { href, broken: true };
    if (target.endsWith(".txt")) return { href: `/${posix.basename(target)}` };
    if (known.has(`${target.replace(/\/$/, "")}/index.md`)) return { href: pageUrl(`${target.replace(/\/$/, "")}/index.md`) + suffix };
  }
  const repoPath = posix.normalize(posix.join("docs/site", posix.dirname(fromFile), path));
  if (repoPath.startsWith("../")) return { href };
  return { href: `${path.endsWith("/") ? REPO_TREE : REPO_BLOB}/${repoPath.replace(/\/$/, "")}${suffix}` };
}

function walk(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, rel) : e.name.endsWith(".md") ? [rel] : [];
  });
}

export function splitFrontmatter(src: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  // Docs frontmatter is "key: value" per line, and values may contain colons, so it isn't parsed as YAML.
  const meta: Record<string, unknown> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: src.slice(m[0].length) };
}

/** Section order and page order come from docs/site/index.md (its "## Section" headings and link lists). */
export function navOrder(indexBody: string): { sections: string[]; rank: Map<string, number> } {
  const sections: string[] = [],
    rank = new Map<string, number>();
  let i = 0;
  for (const line of indexBody.split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) sections.push(h[1]!.trim());
    const l = /^\s*-\s+\[[^\]]+\]\(([^)#]+\.md)/.exec(line);
    if (l) rank.set(l[1]!, i++);
  }
  return { sections, rank };
}

const LANGS = [
  "bash",
  "yaml",
  "json",
  "jsonc",
  "typescript",
  "tsx",
  "javascript",
  "markdown",
  "toml",
  "diff",
  "dockerfile",
  "sql",
  "python",
  "go",
  "ini",
  "http",
  "text",
];
const ALIAS: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  console: "bash",
  zsh: "bash",
  yml: "yaml",
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  env: "ini",
  "": "text",
  plain: "text",
  txt: "text",
};

type Highlighter = { codeToHtml: (code: string, o: { lang: string; theme: string }) => string };

function render(page: Omit<Page, "html" | "headings">, known: Set<string>, hl: Highlighter, broken: string[]): { html: string; headings: Heading[] } {
  const headings: Heading[] = [],
    seen = new Map<string, number>();
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(text) || "section";
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 2 || depth === 3) headings.push({ depth, id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const raw = (lang ?? "").split(/\s/)[0]!.toLowerCase();
        const l = ALIAS[raw] ?? (LANGS.includes(raw) ? raw : "text");
        return `<div class="code"><button class="copy" type="button" aria-label="Copy code">Copy</button>${hl.codeToHtml(text, { lang: l, theme: "github-dark-default" })}</div>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const r = rewriteHref(href, page.file, known);
        if (r.broken) broken.push(`${page.file}: ${href}`);
        const external = /^https?:/i.test(r.href);
        return `<a href="${esc(r.href)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' target="_blank" rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  const html = (md.parse(page.body, { async: false }) as string).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");
  return { html, headings };
}

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#fafafa"/><path fill="#171717" transform="translate(6.4 6.4) scale(1.2)" d="M3 13.5 6.2 2.5h2.6L5.6 13.5zM7.4 13.5l3.2-11h2.6l-3.2 11z"/></svg>`;

function layout(p: Page, nav: string, prev?: Page, next?: Page): string {
  const toc = p.headings.length
    ? `<nav class="toc" aria-label="On this page"><h5>On this page</h5>${p.headings.map((h) => `<a class="d${h.depth}" href="#${h.id}">${h.text}</a>`).join("")}</nav>`
    : `<nav class="toc"></nav>`;
  const pager = `<div class="pager">${prev ? `<a class="prev" href="${prev.url}"><small>Previous</small>${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${next.url}"><small>Next</small>${esc(next.title)}</a>` : "<span></span>"}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · Kiln docs</title>
<meta name="description" content="${esc(p.description)}">
<meta property="og:title" content="${esc(p.title)} · Kiln docs"><meta property="og:description" content="${esc(p.description)}"><meta property="og:image" content="/assets/hero.png">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO.replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"'))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/docs/_assets/docs.css">
</head>
<body>
<header class="top">
  <button class="menu" id="menu" aria-label="Open the docs menu" aria-controls="side" aria-expanded="false"><span></span><span></span><span></span></button>
  <a class="brand" href="/">${LOGO}Kiln</a><a class="docs-home" href="/docs/">Docs</a>
  <div class="search"><input id="q" type="search" placeholder="Search docs" autocomplete="off" aria-label="Search the docs"><kbd>/</kbd><div class="results" id="results" role="listbox"></div></div>
  <nav class="links"><a href="/">Website</a><a href="https://github.com/fishuke/kiln" target="_blank" rel="noopener">GitHub</a></nav>
</header>
<div class="layout">
  <aside class="side" id="side">${nav}</aside>
  <main class="doc">
    <div class="crumbs">${esc(p.section)}</div>
    <h1>${esc(p.title)}</h1>
    ${p.description ? `<p class="lede">${esc(p.description)}</p>` : ""}
    <article>${p.html}</article>
    <a class="edit" href="${REPO_BLOB}/docs/site/${p.file}" target="_blank" rel="noopener">Edit this page on GitHub</a>
    ${pager}
  </main>
  ${toc}
</div>
<script src="/docs/_assets/docs.js" defer></script>
</body>
</html>
`;
}

export async function buildDocsSite(opts: { src?: string; out?: string } = {}) {
  const src = opts.src ?? SRC,
    out = opts.out ?? OUT;
  const files = walk(src).sort();
  const known = new Set(files);
  const raw = files.map((file) => {
    const { meta, body } = splitFrontmatter(readFileSync(join(src, file), "utf8"));
    return {
      file,
      url: pageUrl(file),
      title: String(meta.title ?? file),
      description: String(meta.description ?? ""),
      section: String(meta.section ?? "Overview"),
      body,
    };
  });
  const index = raw.find((p) => p.file === "index.md");
  const { sections, rank } = navOrder(index?.body ?? "");
  const order = (p: { file: string; section: string }) => [
    sections.indexOf(p.section) < 0 ? 99 : sections.indexOf(p.section),
    p.file === "index.md" ? -1 : (rank.get(p.file) ?? 999),
  ];
  raw.sort((a, b) => {
    const [sa, ra] = order(a),
      [sb, rb] = order(b);
    return sa! - sb! || ra! - rb! || a.title.localeCompare(b.title);
  });

  const { createHighlighter } = await import("shiki");
  const hl = await createHighlighter({ themes: ["github-dark-default"], langs: LANGS.filter((l) => l !== "text") });
  const broken: string[] = [];
  const pages: Page[] = raw.map((p) => ({ ...p, ...render(p, known, hl, broken) }));
  if (broken.length) throw new Error(`broken links between docs pages:\n  ${broken.join("\n  ")}`);

  const bySection = new Map<string, Page[]>();
  for (const p of pages) if (p.file !== "index.md") bySection.set(p.section, [...(bySection.get(p.section) ?? []), p]);
  const navFor = (cur: Page) =>
    `<a class="home${cur.file === "index.md" ? " on" : ""}" href="/docs/">Introduction</a>` +
    [...bySection]
      .map(
        ([sec, ps]) =>
          `<div class="sec"><h5>${esc(sec)}</h5>${ps.map((p) => `<a href="${p.url}"${p === cur ? ' class="on" aria-current="page"' : ""}>${esc(p.title)}</a>`).join("")}</div>`,
      )
      .join("");

  rmSync(out, { recursive: true, force: true });
  pages.forEach((p, i) => {
    const dir = join(out, p.url.replace(/^\/docs\/?/, ""));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), layout(p, navFor(p), pages[i - 1], pages[i + 1]));
  });
  mkdirSync(join(out, "_assets"), { recursive: true });
  for (const f of ["docs.css", "docs.js"]) copyFileSync(join(ASSETS, f), join(out, "_assets", f));
  const text = (html: string) =>
    html
      .replace(/<pre[\s\S]*?<\/pre>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  writeFileSync(
    join(out, "search.json"),
    JSON.stringify(
      pages.map((p) => ({ u: p.url, t: p.title, d: p.description, s: p.section, h: p.headings.map((h) => [h.text, h.id]), x: text(p.html).slice(0, 1200) })),
    ),
  );
  const site = dirname(out);
  for (const f of ["llms.txt", "llms-full.txt"]) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(site, f));
  return { pages: pages.length, sections: bySection.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildDocsSite()
    .then((r) => console.log(`Built ${r.pages} docs pages in ${r.sections} sections into website/docs/`))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
