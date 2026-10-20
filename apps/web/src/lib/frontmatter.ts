import YAML from "yaml";

export class FrontmatterError extends Error {}

/** Splits `---\n<yaml>\n---\n<body>` into data and body. Files without front matter have empty data. */
export function parseFrontmatter(src: string): { data: Record<string, unknown>; body: string } {
  const text = (src ?? "").replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  let data: unknown;
  try {
    data = YAML.parse(m[1] ?? "") ?? {};
  } catch (e) {
    throw new FrontmatterError(`front matter is not valid YAML: ${(e as Error).message}`);
  }
  if (typeof data !== "object" || Array.isArray(data)) throw new FrontmatterError("front matter must be a YAML mapping");
  return { data: data as Record<string, unknown>, body: m[2] ?? "" };
}

/** Drops undefined values so YAML output stays minimal; keeps null (it clears inherited values). */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function toYaml(data: unknown): string {
  return YAML.stringify(data, { lineWidth: 0 });
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = toYaml(compact(data));
  const text = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `---\n${yaml}---\n${text ? `${text}\n` : ""}`;
}

/** Directory-safe resource name: keeps spaces and case (paths are identities), drops slashes and control chars. */
export function resourceName(name: string): string {
  return name.replace(/[/\\\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
