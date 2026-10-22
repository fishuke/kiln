import { lineAt, parseTree, type DefinitionError, type DefinitionTree, type ParsedFactory, type Skill } from "@kiln/definitions";
import { AppManifest, AppPolicy } from "@kiln/schema";
import { LineCounter, parseDocument } from "yaml";

type Source = ParsedFactory["sources"][string];

/** One layer of an App definition (team, Kiln Project or App), parsed. Agents and skills are the factory kinds, parsed by `parseTree`. */
export type AppLayerTree = {
  manifest?: AppManifest;
  agents: ParsedFactory["agents"];
  /** Shared skills (`skills/<name>/SKILL.md`). */
  skills: Record<string, Skill>;
  /** By file name, without `.yaml`. `content` is the file as written. */
  policies: Record<string, { policy: AppPolicy; content: string }>;
  /** The layer's files as written, for export. */
  files: DefinitionTree;
};

export type AppTreeResult = AppLayerTree & { errors: DefinitionError[]; warnings: DefinitionError[] };

/** Factory files that have no meaning in an App. */
const FACTORY_ONLY: [RegExp, string][] = [
  [/^factory\.yaml$/, "factory.yaml doesn't apply to Apps; use app.yaml"],
  [/^pipelines\//, "pipelines don't apply to Apps"],
  [/^automations\//, "automations don't apply to Apps"],
  [/^gates\//, "gates don't apply to Apps"],
  [/^runners\//, "runners don't apply to Apps"],
  [/^routers\//, "routers don't apply to Apps"],
  [/^scorers\//, "scorers don't apply to Apps"],
  [/^benchmarks\//, "benchmarks don't apply to Apps"],
  [/^webhooks\//, "webhooks don't apply to Apps"],
  [/^decisions\//, "decisions don't apply to Apps"],
  [/^memories\//, "memories don't apply to Apps"],
];

/** Agent keys that only mean something in a factory; an App ignores them. */
const IGNORED_AGENT_KEYS = ["agentType", "runner", "workerHost", "environmentId", "required_repos", "credentialStrategy"];

const FACTORY_KINDS = [/^agents\//, /^skills\//];
const IGNORED_FILES = [/^README\.md$/i, /(^|\/)\.gitkeep$/];

/**
 * Parse and check one App definition layer. Agents and skills go through the factory parser
 * (`parseTree`); `app.yaml` and `policies/` use the App kinds. `inheritedSkills` and `inheritedAgents` are the shared
 * skills of the layers this one inherits from, for skill references.
 */
export function validateAppTree(tree: DefinitionTree, opts: { inheritedSkills?: string[]; inheritedAgents?: string[] } = {}): AppTreeResult {
  const errors: DefinitionError[] = [];
  const warnings: DefinitionError[] = [];
  const factoryPart: DefinitionTree = {};
  const policies: AppLayerTree["policies"] = {};
  let manifest: AppManifest | undefined;
  let manifestSource: Source | undefined;

  const parseYaml = (file: string): { raw: unknown; source: Source } | undefined => {
    const counter = new LineCounter();
    const doc = parseDocument(tree[file]!, { lineCounter: counter, prettyErrors: true });
    const source: Source = { file, doc, counter, lineOffset: 0 };
    if (!doc.errors.length) return { raw: doc.toJS() ?? {}, source };
    for (const e of doc.errors) errors.push({ file, line: e.linePos?.[0]?.line ?? 1, code: "yaml", message: e.message.split("\n")[0]! });
    return undefined;
  };
  const check = <T>(
    file: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  ) => {
    const y = parseYaml(file);
    if (!y) return undefined;
    const r = schema.safeParse(y.raw);
    if (r.success) return { data: r.data, source: y.source };
    for (const issue of r.error.issues) {
      const path = issue.path.map((p) => (typeof p === "number" ? p : String(p)));
      errors.push({ file, line: lineAt(y.source, path), code: "schema", message: path.length ? `${path.join(".")}: ${issue.message}` : issue.message });
    }
    return undefined;
  };

  let m: RegExpExecArray | null;
  for (const file of Object.keys(tree).sort()) {
    const factoryOnly = FACTORY_ONLY.find(([re]) => re.test(file));
    if (factoryOnly) errors.push({ file, line: 1, code: "app", message: factoryOnly[1] });
    else if (FACTORY_KINDS.some((re) => re.test(file))) factoryPart[file] = tree[file]!;
    else if (file === "app.yaml") {
      const r = check(file, AppManifest);
      if (r) [manifest, manifestSource] = [r.data, r.source];
    } else if ((m = /^policies\/([^/]+)\.yaml$/.exec(file))) {
      const r = check(file, AppPolicy);
      if (r) policies[m[1]!] = { policy: r.data, content: tree[file]! };
    } else if (!IGNORED_FILES.some((re) => re.test(file))) {
      errors.push({ file, line: 1, code: "unknown-file", message: `${file} is not a known App definition file` });
    }
  }

  const parsed = parseTree(factoryPart);
  // An App has no factory.yaml; every other parse error stands.
  errors.push(...parsed.errors.filter((e) => !(e.file === "factory.yaml" && e.code === "missing")));
  warnings.push(...parsed.warnings);

  const agentNames = new Set([...Object.keys(parsed.agents), ...(opts.inheritedAgents ?? [])]);
  const sharedSkills = new Set([...Object.keys(parsed.skills), ...(opts.inheritedSkills ?? [])]);
  for (const [name, a] of Object.entries(parsed.agents)) {
    const source = parsed.sources[`agent/${name}`]!;
    const err = (path: (string | number)[], message: string) => errors.push({ file: source.file, line: lineAt(source, path), code: "ref", message });
    if (a.frontmatter.harness && a.frontmatter.model) err(["model"], "set exactly one of model or harness, not both");
    for (const model of [a.frontmatter.model, a.frontmatter.harness?.model]) {
      if (model?.startsWith("router:")) err(["model"], `${model} needs a router, and Apps have none; name a model`);
    }
    const raw = (source.doc?.toJS() ?? {}) as Record<string, unknown>;
    for (const key of IGNORED_AGENT_KEYS) {
      if (key in raw)
        warnings.push({ file: source.file, line: lineAt(source, [key]), code: "ignored", message: `${key} doesn't apply to an App and is ignored` });
    }
    for (const [i, other] of (a.frontmatter.spawnableBy ?? []).entries()) {
      if (!agentNames.has(other)) err(["spawnableBy", i], `spawnableBy names unknown agent ${other}`);
    }
  }
  for (const [i, name] of (manifest?.skills?.mandatory ?? []).entries()) {
    if (!sharedSkills.has(name))
      errors.push({
        file: "app.yaml",
        line: lineAt(manifestSource, ["skills", "mandatory", i]),
        code: "ref",
        message: `mandatory skill ${name} is not defined in skills/`,
      });
  }

  const order = (a: DefinitionError, b: DefinitionError) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1);
  return {
    ...(manifest ? { manifest } : {}),
    agents: parsed.agents,
    skills: parsed.skills,
    policies,
    files: tree,
    errors: errors.sort(order),
    warnings: warnings.sort(order),
  };
}

/** `file:line: message`, one per line. */
export function formatErrors(errors: DefinitionError[]): string {
  return errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n");
}
