import { Document, isMap, parseDocument, stringify } from "yaml";

/** Frontmatter at the top of a Markdown definition file (agent.md, scorer.md, automation.md). */
const FENCE = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?/;

export type Frontmatter = { data: Record<string, unknown>; body: string; yaml: string };

export function parseFrontmatter(source: string): Frontmatter {
  const m = FENCE.exec(source);
  if (!m) return { data: {}, body: source, yaml: "" };
  const doc = parseDocument(m[1] ?? "");
  const data = doc.toJS();
  return { data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: source.slice(m[0].length), yaml: m[1] ?? "" };
}

/** A value of `undefined` deletes the key; `null` is written as YAML null (clears an inherited value). */
export type Patch = Record<string, unknown>;

function isEmpty(v: unknown) {
  return v === undefined;
}

/** Sets or deletes `path` in a YAML document while keeping comments, key order and untouched keys. */
export function setPath(doc: Document, path: (string | number)[], value: unknown) {
  if (isEmpty(value)) {
    if (doc.hasIn(path)) doc.deleteIn(path);
    // Drop parents that became empty maps.
    for (let i = path.length - 1; i > 0; i--) {
      const parent = doc.getIn(path.slice(0, i), true);
      if (isMap(parent) && parent.items.length === 0) doc.deleteIn(path.slice(0, i));
      else break;
    }
    return;
  }
  doc.setIn(path, doc.createNode(value));
}

/** Applies a flat patch (keys may be dotted paths like `harness.model`) to a YAML string. */
export function patchYaml(source: string, patch: Patch): string {
  let doc: Document = parseDocument(source);
  if (!isMap(doc.contents)) doc = new Document({});
  for (const [key, value] of Object.entries(patch)) setPath(doc, key.split("."), value);
  const out = doc.toString({ lineWidth: 0 });
  return out.trim() === "{}" ? "" : out;
}

/** Rewrites the frontmatter of a Markdown file; `body` replaces the Markdown body when given. */
export function updateFrontmatter(source: string, patch: Patch, body?: string): string {
  const fm = parseFrontmatter(source);
  const yaml = patchYaml(fm.yaml, patch);
  const nextBody = body ?? fm.body;
  return `---\n${yaml.endsWith("\n") || !yaml ? yaml : `${yaml}\n`}---\n${nextBody.replace(/^\n+/, "")}`;
}

/** Builds a new Markdown file from data and body (keys with `undefined` are dropped). */
export function writeFrontmatter(data: Record<string, unknown>, body: string): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const yaml = Object.keys(clean).length ? stringify(clean, { lineWidth: 0 }) : "";
  return `---\n${yaml}---\n${body.replace(/^\n+/, "")}`;
}
