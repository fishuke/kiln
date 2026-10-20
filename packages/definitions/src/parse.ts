import { LineCounter, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import {
  AgentFrontmatter,
  AutomationFrontmatter,
  BenchmarkSuite,
  BenchmarkTask,
  Decision,
  Factory,
  Gate,
  MemoryFrontmatter,
  Pipeline,
  Policy,
  Router,
  Runner,
  ScorerFrontmatter,
  SkillFrontmatter,
  Webhook,
} from "@kiln/schema";
import { splitFrontmatter, treeSha, type DefinitionTree } from "./tree";

export type DefinitionError = { file: string; line: number; message: string; code: string };

export type ParsedFactory = {
  sha: string;
  factory?: Factory;
  agents: Record<string, { frontmatter: AgentFrontmatter; instructions: string; skills: Record<string, Skill> }>;
  automations: Record<string, { frontmatter: AutomationFrontmatter; prompt: string }>;
  pipelines: Record<string, Pipeline>;
  gates: Record<string, Gate>;
  policies: Record<string, Policy>;
  runners: Record<string, Runner>;
  routers: Record<string, Router>;
  webhooks: Record<string, Webhook>;
  decisions: Record<string, Decision>;
  scorers: Record<string, { frontmatter: ScorerFrontmatter; rubric: string }>;
  benchmarks: Record<string, { suite: BenchmarkSuite; tasks: Record<string, BenchmarkTask> }>;
  skills: Record<string, Skill>;
  memories: Record<string, { frontmatter: MemoryFrontmatter; body: string }>;
  /** Where each resource came from, for error reporting: "agent/foreman" → file. */
  sources: Record<string, { file: string; doc?: Document; lineOffset: number; counter?: LineCounter }>;
  errors: DefinitionError[];
  warnings: DefinitionError[];
};

export type Skill = { frontmatter: SkillFrontmatter; body: string; file: string };

function yamlDoc(src: string) {
  const counter = new LineCounter();
  const doc = parseDocument(src, { lineCounter: counter, prettyErrors: true });
  return { doc, counter };
}

/** Line of the node at `path` (1-based), falling back to the first line of the document. */
export function lineAt(source: ParsedFactory["sources"][string] | undefined, path: (string | number)[]): number {
  if (!source?.doc || !source.counter) return 1 + (source?.lineOffset ?? 0);
  for (let len = path.length; len >= 0; len--) {
    const node = source.doc.getIn(path.slice(0, len), true) as { range?: [number, number, number] } | undefined;
    if (node && typeof node === "object" && node.range) {
      return source.counter.linePos(node.range[0]).line + source.lineOffset;
    }
    if (len > 0) {
      // For map keys, `getIn` returns the value; when that has no range try the parent pair.
      continue;
    }
  }
  return 1 + source.lineOffset;
}

type Kind = { schema: z.ZodType; frontmatter: boolean };

const KINDS: { pattern: RegExp; kind: string; spec: Kind }[] = [
  { pattern: /^factory\.yaml$/, kind: "factory", spec: { schema: Factory, frontmatter: false } },
  { pattern: /^agents\/([^/]+)\/agent\.md$/, kind: "agent", spec: { schema: AgentFrontmatter, frontmatter: true } },
  {
    pattern: /^agents\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/,
    kind: "agent-skill",
    spec: { schema: SkillFrontmatter, frontmatter: true },
  },
  {
    pattern: /^automations\/([^/]+)\/automation\.md$/,
    kind: "automation",
    spec: { schema: AutomationFrontmatter, frontmatter: true },
  },
  { pattern: /^pipelines\/([^/]+)\.yaml$/, kind: "pipeline", spec: { schema: Pipeline, frontmatter: false } },
  { pattern: /^gates\/([^/]+)\.yaml$/, kind: "gate", spec: { schema: Gate, frontmatter: false } },
  { pattern: /^policies\/([^/]+)\.yaml$/, kind: "policy", spec: { schema: Policy, frontmatter: false } },
  { pattern: /^runners\/([^/]+)\.yaml$/, kind: "runner", spec: { schema: Runner, frontmatter: false } },
  { pattern: /^routers\/([^/]+)\.yaml$/, kind: "router", spec: { schema: Router, frontmatter: false } },
  { pattern: /^webhooks\/([^/]+)\.yaml$/, kind: "webhook", spec: { schema: Webhook, frontmatter: false } },
  { pattern: /^decisions\/([^/]+)\.yaml$/, kind: "decision", spec: { schema: Decision, frontmatter: false } },
  { pattern: /^scorers\/([^/]+)\/scorer\.md$/, kind: "scorer", spec: { schema: ScorerFrontmatter, frontmatter: true } },
  {
    pattern: /^benchmarks\/([^/]+)\/suite\.yaml$/,
    kind: "benchmark-suite",
    spec: { schema: BenchmarkSuite, frontmatter: false },
  },
  {
    pattern: /^benchmarks\/([^/]+)\/tasks\/([^/]+)\.yaml$/,
    kind: "benchmark-task",
    spec: { schema: BenchmarkTask, frontmatter: false },
  },
  { pattern: /^skills\/([^/]+)\/SKILL\.md$/, kind: "skill", spec: { schema: SkillFrontmatter, frontmatter: true } },
  { pattern: /^memories\/([^/]+)\.md$/, kind: "memory", spec: { schema: MemoryFrontmatter, frontmatter: true } },
];

/** Files that may live in a tree without being definitions. */
const IGNORED = [/^README\.md$/i, /^\.github\//, /^LICENSE$/, /^\.gitkeep$/, /(^|\/)\.gitkeep$/, /^skills\/[^/]+\/.+/, /^agents\/[^/]+\/skills\/[^/]+\/.+/];

export function parseTree(tree: DefinitionTree): ParsedFactory {
  const out: ParsedFactory = {
    sha: treeSha(tree),
    agents: {},
    automations: {},
    pipelines: {},
    gates: {},
    policies: {},
    runners: {},
    routers: {},
    webhooks: {},
    decisions: {},
    scorers: {},
    benchmarks: {},
    skills: {},
    memories: {},
    sources: {},
    errors: [],
    warnings: [],
  };
  const agentSkills: { agent: string; name: string; skill: Skill }[] = [];
  const benchTasks: { suite: string; name: string; task: BenchmarkTask }[] = [];

  for (const file of Object.keys(tree).sort()) {
    const match = KINDS.map((k) => ({ k, m: k.pattern.exec(file) })).find((x) => x.m);
    if (!match) {
      if (!IGNORED.some((re) => re.test(file))) {
        out.warnings.push({ file, line: 1, code: "unknown-file", message: `${file} is not a known definition file` });
      }
      continue;
    }
    const { k, m } = match;
    const content = tree[file]!;
    let yamlSrc = content;
    let body = "";
    let lineOffset = 0;
    if (k.spec.frontmatter) {
      const fm = splitFrontmatter(content);
      yamlSrc = fm.yaml;
      body = fm.body;
      lineOffset = fm.hasFrontmatter ? 1 : 0;
    }
    const { doc, counter } = yamlDoc(yamlSrc);
    const key = `${k.kind}/${m!.slice(1).join("/")}`;
    const source = { file, doc, counter, lineOffset };
    out.sources[key] = source;
    if (doc.errors.length > 0) {
      for (const err of doc.errors) {
        out.errors.push({
          file,
          line: (err.linePos?.[0]?.line ?? 1) + lineOffset,
          code: "yaml",
          message: err.message.split("\n")[0]!,
        });
      }
      continue;
    }
    const raw = doc.toJS() ?? {};
    const result = k.spec.schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.map((p) => (typeof p === "number" ? p : String(p)));
        out.errors.push({
          file,
          line: lineAt(source, path),
          code: "schema",
          message: path.length ? `${path.join(".")}: ${issue.message}` : issue.message,
        });
      }
      continue;
    }
    const data = result.data as never;
    const [a, b] = [m![1]!, m![2]];
    switch (k.kind) {
      case "factory":
        out.factory = data;
        break;
      case "agent":
        out.agents[a] = { frontmatter: data, instructions: body, skills: {} };
        break;
      case "agent-skill":
        agentSkills.push({ agent: a, name: b!, skill: { frontmatter: data, body, file } });
        break;
      case "automation":
        out.automations[a] = { frontmatter: data, prompt: body };
        break;
      case "pipeline":
        out.pipelines[a] = data;
        break;
      case "gate":
        out.gates[a] = data;
        break;
      case "policy":
        out.policies[a] = data;
        break;
      case "runner":
        out.runners[a] = data;
        break;
      case "router":
        out.routers[a] = data;
        break;
      case "webhook":
        out.webhooks[a] = data;
        break;
      case "decision":
        out.decisions[a] = data;
        break;
      case "scorer":
        out.scorers[a] = { frontmatter: data, rubric: body };
        break;
      case "benchmark-suite":
        out.benchmarks[a] = { suite: data, tasks: out.benchmarks[a]?.tasks ?? {} };
        break;
      case "benchmark-task":
        benchTasks.push({ suite: a, name: b!, task: data });
        break;
      case "skill":
        out.skills[a] = { frontmatter: data, body, file };
        break;
      case "memory":
        out.memories[a] = { frontmatter: data, body };
        break;
    }
  }

  for (const { agent, name, skill } of agentSkills) {
    const target = out.agents[agent];
    if (!target) {
      out.errors.push({ file: skill.file, line: 1, code: "ref", message: `skill ${name} belongs to unknown agent ${agent}` });
      continue;
    }
    target.skills[name] = skill;
  }
  for (const { suite, name, task } of benchTasks) {
    const target = out.benchmarks[suite];
    if (!target) {
      out.errors.push({
        file: `benchmarks/${suite}/tasks/${name}.yaml`,
        line: 1,
        code: "ref",
        message: `task ${name} has no benchmarks/${suite}/suite.yaml`,
      });
      continue;
    }
    target.tasks[name] = task;
  }
  if (!out.factory && !out.errors.some((e) => e.file === "factory.yaml")) {
    out.errors.push({ file: "factory.yaml", line: 1, code: "missing", message: "factory.yaml is required" });
  }
  return out;
}
