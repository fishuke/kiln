import { lineAt, splitFrontmatter, type DefinitionError, type DefinitionTree, type ParsedFactory } from "@kiln/definitions";
import { AgentFrontmatter, AppManifest, AppPolicy, SkillFrontmatter } from "@kiln/schema";
import { LineCounter, parseDocument } from "yaml";
import type { z } from "zod";

type Source = ParsedFactory["sources"][string];

/** One layer of an App definition (team, Kiln Project or App), parsed. */
export type AppLayerTree = {
  manifest?: AppManifest;
  lead?: { name: string; frontmatter: AgentFrontmatter; instructions: string };
  /** By skill name (its directory). `content` is the SKILL.md file as written. */
  skills: Record<string, { frontmatter: SkillFrontmatter; body: string; content: string }>;
  /** By file name, without `.yaml`. `content` is the file as written. */
  policies: Record<string, { policy: AppPolicy; content: string }>;
};

export type AppTreeResult = AppLayerTree & { errors: DefinitionError[]; warnings: DefinitionError[] };

/** Factory directories that have no meaning in an App. */
const FACTORY_ONLY: [RegExp, string][] = [
  [/^factory\.yaml$/, "factory.yaml doesn't apply to Apps; use app.yaml"],
  [/^agents\/[^/]+\/skills\//, "agent skills don't apply to Apps; use skills/"],
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

/** Agent keys a factory uses that an App's lead ignores. */
const IGNORED_AGENT_KEYS = ["agentType", "spawnableBy", "runner", "workerHost", "environmentId", "idleTimeoutMinutes", "required_repos", "credentialStrategy"];

const IGNORED_FILES = [/^README\.md$/i, /(^|\/)\.gitkeep$/, /^skills\/[^/]+\/.+/];

/**
 * Parse and check one App definition layer. Files use the factory schemas they share
 * (AgentFrontmatter, SkillFrontmatter) and the App kinds (AppManifest, AppPolicy).
 * `inheritedSkills` are the skills of the layers this one inherits from, for mandatory skill checks.
 */
export function validateAppTree(tree: DefinitionTree, opts: { inheritedSkills?: string[] } = {}): AppTreeResult {
  const out: AppTreeResult = { skills: {}, policies: {}, errors: [], warnings: [] };
  const agents: { name: string; frontmatter: AgentFrontmatter; raw: Record<string, unknown>; instructions: string; source: Source }[] = [];
  let manifestSource: Source | undefined;

  const parse = <S extends z.ZodType>(
    file: string,
    schema: S,
    frontmatter: boolean,
  ): { data: z.infer<S>; raw: Record<string, unknown>; body: string; source: Source } | undefined => {
    const content = tree[file]!;
    const fm = frontmatter ? splitFrontmatter(content) : { yaml: content, body: "", hasFrontmatter: false };
    const counter = new LineCounter();
    const doc = parseDocument(fm.yaml, { lineCounter: counter, prettyErrors: true });
    const source: Source = { file, doc, counter, lineOffset: fm.hasFrontmatter ? 1 : 0 };
    if (doc.errors.length) {
      for (const e of doc.errors)
        out.errors.push({ file, line: (e.linePos?.[0]?.line ?? 1) + source.lineOffset, code: "yaml", message: e.message.split("\n")[0]! });
      return undefined;
    }
    const raw = (doc.toJS() ?? {}) as Record<string, unknown>;
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.map((p) => (typeof p === "number" ? p : String(p)));
        out.errors.push({ file, line: lineAt(source, path), code: "schema", message: path.length ? `${path.join(".")}: ${issue.message}` : issue.message });
      }
      return undefined;
    }
    return { data: result.data, raw, body: fm.body, source };
  };

  for (const file of Object.keys(tree).sort()) {
    let m: RegExpExecArray | null;
    const factoryOnly = FACTORY_ONLY.find(([re]) => re.test(file));
    if (factoryOnly) {
      out.errors.push({ file, line: 1, code: "app", message: factoryOnly[1] });
    } else if (file === "app.yaml") {
      const p = parse(file, AppManifest, false);
      if (p) [out.manifest, manifestSource] = [p.data, p.source];
    } else if ((m = /^agents\/([^/]+)\/agent\.md$/.exec(file))) {
      const p = parse(file, AgentFrontmatter, true);
      if (p) agents.push({ name: m[1]!, frontmatter: p.data, raw: p.raw, instructions: p.body, source: p.source });
    } else if ((m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file))) {
      const p = parse(file, SkillFrontmatter, true);
      if (p) out.skills[m[1]!] = { frontmatter: p.data, body: p.body, content: tree[file]! };
    } else if ((m = /^policies\/([^/]+)\.yaml$/.exec(file))) {
      const p = parse(file, AppPolicy, false);
      if (p) out.policies[m[1]!] = { policy: p.data, content: tree[file]! };
    } else if (!IGNORED_FILES.some((re) => re.test(file))) {
      out.errors.push({ file, line: 1, code: "unknown-file", message: `${file} is not a known App definition file` });
    }
  }

  if (agents.length > 1) {
    out.errors.push({
      file: "agents/",
      line: 1,
      code: "lead",
      message: `an App has at most one agent, the lead; found ${agents.map((a) => a.name).join(", ")}`,
    });
  }
  for (const a of agents) {
    const err = (path: string[], message: string) => out.errors.push({ file: a.source.file, line: lineAt(a.source, path), code: "lead", message });
    if (a.frontmatter.harness && a.frontmatter.model) err(["model"], "set exactly one of model or harness, not both");
    for (const model of [a.frontmatter.model, a.frontmatter.harness?.model]) {
      if (model?.startsWith("router:")) err(["model"], `${model} needs a router, and Apps have none; name a model`);
    }
    for (const key of IGNORED_AGENT_KEYS) {
      if (key in a.raw)
        out.warnings.push({ file: a.source.file, line: lineAt(a.source, [key]), code: "ignored", message: `${key} doesn't apply to an App and is ignored` });
    }
  }
  if (agents.length === 1) out.lead = { name: agents[0]!.name, frontmatter: agents[0]!.frontmatter, instructions: agents[0]!.instructions };

  const known = new Set([...Object.keys(out.skills), ...(opts.inheritedSkills ?? [])]);
  for (const [i, name] of (out.manifest?.skills?.mandatory ?? []).entries()) {
    if (!known.has(name))
      out.errors.push({
        file: "app.yaml",
        line: lineAt(manifestSource, ["skills", "mandatory", i]),
        code: "ref",
        message: `mandatory skill ${name} is not defined in skills/`,
      });
  }

  const order = (a: DefinitionError, b: DefinitionError) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1);
  out.errors.sort(order);
  out.warnings.sort(order);
  return out;
}

/** `file:line: message`, one per line. */
export function formatErrors(errors: DefinitionError[]): string {
  return errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n");
}
