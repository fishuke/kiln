import { parseTree, type ParsedFactory } from "./parse";
import type { DefinitionTree } from "./tree";

export type DefinitionDiff = { added: string[]; changed: string[]; removed: string[] };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Flatten a parsed tree into resource keys like "agent/foreman" → comparable JSON. */
export function resources(parsed: ParsedFactory): Record<string, string> {
  const out: Record<string, string> = {};
  if (parsed.factory) out["factory"] = stable(parsed.factory);
  const groups = {
    agent: parsed.agents,
    automation: parsed.automations,
    pipeline: parsed.pipelines,
    gate: parsed.gates,
    policy: parsed.policies,
    runner: parsed.runners,
    router: parsed.routers,
    webhook: parsed.webhooks,
    decision: parsed.decisions,
    scorer: parsed.scorers,
    benchmark: parsed.benchmarks,
    skill: parsed.skills,
    memory: parsed.memories,
  } as const;
  for (const [kind, group] of Object.entries(groups)) {
    for (const [name, value] of Object.entries(group as Record<string, unknown>)) {
      out[`${kind}/${name}`] = stable(value);
    }
  }
  return out;
}

export function diffParsed(before: ParsedFactory | undefined, after: ParsedFactory): DefinitionDiff {
  const a = before ? resources(before) : {};
  const b = resources(after);
  const diff: DefinitionDiff = { added: [], changed: [], removed: [] };
  for (const key of Object.keys(b).sort()) {
    if (!(key in a)) diff.added.push(key);
    else if (a[key] !== b[key]) diff.changed.push(key);
  }
  for (const key of Object.keys(a).sort()) if (!(key in b)) diff.removed.push(key);
  return diff;
}

export function diffTrees(before: DefinitionTree | undefined, after: DefinitionTree): DefinitionDiff {
  return diffParsed(before ? parseTree(before) : undefined, parseTree(after));
}

export function formatDiff(diff: DefinitionDiff): string {
  const lines = [
    ...diff.added.map((k) => `+ ${k}`),
    ...diff.changed.map((k) => `~ ${k}`),
    ...diff.removed.map((k) => `- ${k}`),
  ];
  return lines.length ? lines.join("\n") : "no changes";
}
