import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** A definition tree: POSIX relative path → file content. */
export type DefinitionTree = Record<string, string>;

const SKIP_DIRS = new Set(["node_modules", ".git", ".next"]);

export function loadTree(root: string): DefinitionTree {
  const tree: DefinitionTree = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else tree[relative(root, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return tree;
}

export function writeTree(root: string, tree: DefinitionTree): void {
  for (const [path, content] of Object.entries(tree)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export function treeSha(tree: DefinitionTree): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(tree).sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(tree[path]!);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 40);
}

export function splitFrontmatter(src: string): { yaml: string; body: string; hasFrontmatter: boolean } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!match) return { yaml: "", body: src, hasFrontmatter: false };
  return { yaml: match[1]!, body: match[2]!.trim(), hasFrontmatter: true };
}
