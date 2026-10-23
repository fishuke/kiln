import type { VariableInput } from "@kiln/sdk-ts";

/** A variable being edited. `stored` marks a secret that already has a value on the server. */
export type VariableRow = { key: string; value: string; secret: boolean; stored: boolean };

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What to send: a saved secret left blank is sent without a value, so the server keeps it. */
export function toVariableInputs(rows: VariableRow[]): VariableInput[] {
  return rows.map((r) => (r.secret && r.stored && !r.value ? { key: r.key.trim(), secret: true } : { key: r.key.trim(), value: r.value, secret: r.secret }));
}

/** The first problem that would make the server refuse these rows, if any. */
export function rowProblem(rows: VariableRow[]): string | undefined {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.key.trim();
    if (!KEY.test(key)) return `${key || "A key"}: use letters, digits and underscores`;
    if (key.startsWith("KILN_")) return `${key}: KILN_ is reserved`;
    if (seen.has(key)) return `${key} is listed twice`;
    seen.add(key);
    if (r.secret && !r.stored && !r.value) return `${key} needs a value`;
  }
  return undefined;
}

/**
 * Merges pasted KEY=value pairs (a .env file) into the rows: a key already listed gets the new
 * value, other keys are added at the end, and the empty row the paste landed in is dropped.
 */
export function mergePasted<R extends VariableRow>(rows: R[], into: R, pairs: { name: string; value: string }[], add: (key: string, value: string) => R): R[] {
  const values = new Map(pairs.map((p) => [p.name, p.value]));
  const merged = rows
    .filter((r) => r !== into || r.key.trim() || r.value)
    .map((r) => (values.has(r.key.trim()) ? { ...r, value: values.get(r.key.trim())! } : r));
  const listed = new Set(merged.map((r) => r.key.trim()));
  return [...merged, ...[...values].filter(([k]) => !listed.has(k)).map(([k, v]) => add(k, v))];
}
