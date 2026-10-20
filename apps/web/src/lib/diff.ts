/** Unified-diff patches (as forges return them per file) turned into numbered lines for the review pane. */

export type DiffLine = { kind: "hunk" | "ctx" | "add" | "del"; text: string; oldLine?: number; newLine?: number };

export function parsePatch(patch: string | undefined): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("\\")) {
      continue;
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
    } else {
      out.push({ kind: "ctx", text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return out;
}

/** Where a line comment lands: the new file, or the old one for a removed line. */
export function commentTarget(l: DiffLine): { line: number; side: "LEFT" | "RIGHT" } | undefined {
  if (l.kind === "hunk") return undefined;
  return l.kind === "del" ? { line: l.oldLine!, side: "LEFT" } : { line: l.newLine!, side: "RIGHT" };
}
