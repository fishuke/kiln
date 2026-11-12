import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocsSite, navOrder, pageUrl, REPO_BLOB, REPO_TREE, rewriteHref, slugify, splitFrontmatter } from "./build-docs-site";

const known = new Set(["index.md", "configuration/agents.md", "measure-and-improve/benchmarks.md", "guides/factory-architect.md"]);

describe("docs site", () => {
  it("maps pages to pretty URLs", () => {
    expect(pageUrl("index.md")).toBe("/docs/");
    expect(pageUrl("configuration/agents.md")).toBe("/docs/configuration/agents/");
  });

  it("rewrites links between docs pages, keeps anchors, and sends repository files to GitHub", () => {
    expect(rewriteHref("../measure-and-improve/benchmarks.md#a-suite", "guides/factory-architect.md", known)).toEqual({
      href: "/docs/measure-and-improve/benchmarks/#a-suite",
    });
    expect(rewriteHref("agents.md", "configuration/agents.md", known)).toEqual({ href: "/docs/configuration/agents/" });
    expect(rewriteHref("#filters", "configuration/agents.md", known)).toEqual({ href: "#filters" });
    expect(rewriteHref("https://example.com", "index.md", known)).toEqual({ href: "https://example.com" });
    expect(rewriteHref("../../adr/0012-studio.md", "configuration/agents.md", known)).toEqual({ href: `${REPO_BLOB}/docs/adr/0012-studio.md` });
    expect(rewriteHref("../../../factories/templates/", "configuration/agents.md", known)).toEqual({ href: `${REPO_TREE}/factories/templates` });
    expect(rewriteHref("llms-full.txt", "index.md", known)).toEqual({ href: "/llms-full.txt" });
    expect(rewriteHref("missing.md", "configuration/agents.md", known).broken).toBe(true);
  });

  it("slugs headings like GitHub", () => {
    expect(slugify("Who may decide from a reply")).toBe("who-may-decide-from-a-reply");
    expect(slugify("`kiln bench from-prs`: the backtest")).toBe("kiln-bench-from-prs-the-backtest");
  });

  it("reads frontmatter whose values contain colons", () => {
    const { meta, body } = splitFrontmatter("---\ntitle: A\ndescription: Self-hostable: agents\n---\nHello");
    expect(meta).toEqual({ title: "A", description: "Self-hostable: agents" });
    expect(body).toBe("Hello");
  });

  it("orders sections and pages as the index lists them", () => {
    const { sections, rank } = navOrder("## Overview\n- [B](overview/b.md): x\n- [A](overview/a.md): y\n## Guides\n- [G](guides/g.md): z");
    expect(sections).toEqual(["Overview", "Guides"]);
    expect(rank.get("overview/b.md")).toBeLessThan(rank.get("overview/a.md")!);
  });

  it("builds pages, search and llms files, and fails on a broken link", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-docs-"));
    const src = join(root, "docs/site"),
      out = join(root, "website/docs");
    const write = (p: string, s: string) => {
      mkdirSync(dirname(join(src, p)), { recursive: true });
      writeFileSync(join(src, p), s);
    };
    write("index.md", "---\ntitle: Kiln documentation\nsection: Overview\n---\n## Overview\n- [Agents](configuration/agents.md): agents\n");
    write(
      "configuration/agents.md",
      "---\ntitle: Factory agents\ndescription: Roles\nsection: Overview\n---\n## Inheritance\n\n```yaml\na: 1\n```\n\nSee [home](../index.md).",
    );
    write("llms.txt", "# Kiln");
    const r = await buildDocsSite({ src, out });
    expect(r.pages).toBe(2);
    const html = readFileSync(join(out, "configuration/agents/index.html"), "utf8");
    expect(html).toContain('<h2 id="inheritance">');
    expect(html).toContain('href="/docs/"');
    expect(html).toContain('class="shiki');
    expect(html).toContain('aria-current="page"');
    expect(JSON.parse(readFileSync(join(out, "search.json"), "utf8"))[1]).toMatchObject({
      u: "/docs/configuration/agents/",
      t: "Factory agents",
      h: [["Inheritance", "inheritance"]],
    });
    expect(existsSync(join(root, "website/llms.txt"))).toBe(true);
    write("configuration/agents.md", "---\ntitle: Factory agents\n---\n[gone](nope.md)");
    await expect(buildDocsSite({ src, out })).rejects.toThrow("configuration/agents.md: nope.md");
  });
});
