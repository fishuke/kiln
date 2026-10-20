/** Helpers for the factory definition editor: tree building, diagnostics, languages and file templates. */

export type TreeNode = { name: string; path: string; kind: "dir" | "file"; children: TreeNode[] };

/** Folders first, then files, each alphabetical; factory.yaml stays last at the root like other files. */
export function buildTree(paths: string[], dirs: string[] = []): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "dir", children: [] };
  const ensureDir = (parts: string[]) => {
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.kind === "dir" && c.name === parts[i]);
      if (!child) node.children.push((child = { name: parts[i]!, path, kind: "dir", children: [] }));
      node = child;
    }
    return node;
  };
  for (const d of dirs) if (d) ensureDir(d.split("/").filter(Boolean));
  for (const p of paths) {
    const parts = p.split("/");
    const dir = ensureDir(parts.slice(0, -1));
    dir.children.push({ name: parts[parts.length - 1]!, path: p, kind: "file", children: [] });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

/** Keep files whose path matches the query, plus the folders that lead to them. */
export function filterPaths(paths: string[], q: string): string[] {
  const needle = q.trim().toLowerCase();
  return needle ? paths.filter((p) => p.toLowerCase().includes(needle)) : paths;
}

export type Diagnostic = { severity: "error" | "warning"; path?: string; line?: number; message: string };

/** "agents/foo/agent.md:2: message" → { path, line, message }. */
export function parseDiagnostic(text: string, severity: Diagnostic["severity"]): Diagnostic {
  const m = /^([^\s:][^:]*?\.(?:ya?ml|md|json|sh|txt)|[^\s:]+\/[^:\s]+):(\d+):\s*([\s\S]*)$/.exec(text);
  if (m) return { severity, path: m[1], line: Number(m[2]), message: m[3]!.trim() };
  const p = /^([^\s:]+\.(?:ya?ml|md)):\s*([\s\S]*)$/.exec(text);
  if (p) return { severity, path: p[1], message: p[2]!.trim() };
  return { severity, message: text };
}

export function languageFor(path: string): string {
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.mdx?$/i.test(path)) return "markdown";
  if (/\.json$/i.test(path)) return "json";
  if (/\.(sh|bash)$/i.test(path) || /\/scripts\/[^.]+$/.test(path)) return "shell";
  if (/\.(ts|tsx)$/i.test(path)) return "typescript";
  if (/\.(js|mjs|cjs)$/i.test(path)) return "javascript";
  if (/\.py$/i.test(path)) return "python";
  return "plaintext";
}

/** Normalise a user-typed path: no leading slash, no "..", single slashes. Returns null when invalid. */
export function cleanPath(input: string): string | null {
  const p = input.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
  if (!p || p.split("/").some((s) => s === ".." || s === ".")) return null;
  return p;
}

export type NewKind = "skill" | "agent" | "automation" | "scorer" | "runner" | "webhook";

export const NEW_KINDS: { kind: NewKind; label: string; placeholder: string }[] = [
  { kind: "skill", label: "New Skill", placeholder: "e.g. code-review" },
  { kind: "agent", label: "New Agent", placeholder: "e.g. Docs Agent" },
  { kind: "automation", label: "New Automation", placeholder: "e.g. Nightly digest" },
  { kind: "scorer", label: "New Scorer", placeholder: "e.g. test-coverage" },
  { kind: "runner", label: "New Runner", placeholder: "e.g. large" },
  { kind: "webhook", label: "New Webhook", placeholder: "e.g. sentry" },
];

/** Path and starter content for a new resource of the given kind. */
export function newResource(kind: NewKind, name: string, opts: { agent?: string; model?: string } = {}): { path: string; content: string } {
  const n = name.trim();
  switch (kind) {
    case "skill":
      return { path: `skills/${n}/SKILL.md`, content: `---\nname: ${n}\ndescription: When to use this skill, in one sentence.\n---\n# ${n}\n\nSteps the agent follows.\n` };
    case "agent":
      return { path: `agents/${n}/agent.md`, content: `---\ndescription: What this agent does.\nagentType: CUSTOM\n---\nYou are the ${n}. Describe its job, its inputs and when it is done.\n` };
    case "automation":
      return { path: `automations/${n}/automation.md`, content: `---\n${opts.agent ? `agent: ${opts.agent}\n` : ""}triggers:\n  - provider: schedule\n    event: cron_fired\n    schedule:\n      cron: "0 9 * * 1"\n---\nWhat the agent should do when this automation fires.\n` };
    case "scorer":
      return {
        path: `scorers/${n}/scorer.md`,
        content: `---\nname: ${n}\nagents: [${opts.agent ?? "implement"}]\nlabels:\n  - { value: pass, score: 1, description: Meets the bar. }\n  - { value: fail, score: 0, description: Misses the bar. }\npassingScore: 0.5\nsamplingRate: 25\nmodel: ${opts.model ?? "claude-haiku-5-5"}\nselfImprovement: false\n---\n**Rubric**\n\nHow the judge decides.\n`,
      };
    case "runner":
      return { path: `runners/${n}.yaml`, content: `description: ${n} runner\nimage: node:22\nbackend: docker\nsetupCommands: []\n` };
    case "webhook":
      return { path: `webhooks/${n}.yaml`, content: `enabled: true\nauthMode: token\nsecretName: ${n.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_WEBHOOK_SECRET\n` };
  }
}
