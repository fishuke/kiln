import { ExprError, parseExpr, refsOf } from "@kiln/schema";
import { lineAt, parseTree, type DefinitionError, type ParsedFactory } from "./parse";
import { resolve, type ResolvedFactory } from "./resolve";
import type { DefinitionTree } from "./tree";

export type ValidationResult =
  | { ok: true; resolved: ResolvedFactory; parsed: ParsedFactory; warnings: DefinitionError[] }
  | { ok: false; errors: DefinitionError[]; parsed: ParsedFactory; warnings: DefinitionError[] };

/** Parse, check cross-references and resolve a tree. Errors carry file and line. */
export function validateTree(tree: DefinitionTree): ValidationResult {
  const parsed = parseTree(tree);
  const errors = [...parsed.errors];
  const err = (key: string, path: (string | number)[], code: string, message: string) => {
    const source = parsed.sources[key];
    errors.push({ file: source?.file ?? key, line: lineAt(source, path), code, message });
  };

  const f = parsed.factory;
  const agentNames = new Set(Object.keys(parsed.agents));
  const runners = new Set(Object.keys(parsed.runners));
  const routers = new Set(Object.keys(parsed.routers));
  const gates = new Set(Object.keys(parsed.gates));
  const skills = new Set(Object.keys(parsed.skills));

  const checkExecution = (key: string, exec: { harness?: unknown; model?: unknown; runner?: unknown }) => {
    if (exec.harness && exec.model) {
      err(key, ["model"], "exactly-one", "set exactly one of model or harness, not both");
    }
    if (typeof exec.runner === "string" && !runners.has(exec.runner)) {
      err(key, ["runner"], "ref", `runner ${exec.runner} is not defined in runners/`);
    }
    const models = [exec.model, (exec.harness as { model?: unknown } | undefined)?.model];
    for (const model of models) {
      if (typeof model === "string" && model.startsWith("router:") && !routers.has(model.slice(7))) {
        err(key, ["model"], "ref", `router ${model.slice(7)} is not defined in routers/`);
      }
    }
  };

  if (f) {
    if (!f.agentDefaults.harness && !f.agentDefaults.model) {
      err("factory/", ["agentDefaults"], "exactly-one", "agentDefaults needs exactly one of model or harness");
    }
    checkExecution("factory/", f.agentDefaults);
    if (f.defaultPipeline && !parsed.pipelines[f.defaultPipeline]) {
      err("factory/", ["defaultPipeline"], "ref", `pipeline ${f.defaultPipeline} is not defined in pipelines/`);
    }
    if (f.selfImprovement?.reviewers.type === "custom" && !f.selfImprovement.reviewers.emails?.length) {
      err("factory/", ["selfImprovement", "reviewers"], "required", "custom reviewers need at least one email");
    }
  }

  const foremen = Object.entries(parsed.agents).filter(([, a]) => a.frontmatter.agentType === "FOREMAN");
  if (foremen.length !== 1 && f) {
    errors.push({
      file: foremen[1] ? `agents/${foremen[1][0]}/agent.md` : "agents/",
      line: 1,
      code: "foreman",
      message: `a factory needs exactly one FOREMAN agent, found ${foremen.length}`,
    });
  }

  for (const [name, agent] of Object.entries(parsed.agents)) {
    const key = `agent/${name}`;
    checkExecution(key, agent.frontmatter);
    for (const [i, other] of (agent.frontmatter.spawnableBy ?? []).entries()) {
      if (!agentNames.has(other)) err(key, ["spawnableBy", i], "ref", `spawnableBy names unknown agent ${other}`);
    }
  }

  for (const [name, au] of Object.entries(parsed.automations)) {
    const key = `automation/${name}`;
    checkExecution(key, au.frontmatter);
    const agent = au.frontmatter.agent;
    if (agent && !agentNames.has(agent)) err(key, ["agent"], "ref", `agent ${agent} is not defined in agents/`);
    for (const [i, t] of au.frontmatter.triggers.entries()) {
      if (t.provider === "webhook") {
        const id = (t.filter as { webhook?: string } | undefined)?.webhook;
        if (!id || !parsed.webhooks[id]) {
          err(key, ["triggers", i, "filter"], "ref", `webhook triggers need filter.webhook naming a file in webhooks/`);
        }
      }
    }
  }

  const attached = new Set((f?.repositories ?? []).map((r) => `${r.owner}/${r.name}`.toLowerCase()));
  const checkRequiredRepos = (key: string, refs: { owner: string; name: string }[] | undefined) => {
    for (const [i, r] of (refs ?? []).entries()) {
      if (f && !attached.has(`${r.owner}/${r.name}`.toLowerCase())) err(key, ["required_repos", i], "ref", `required repo ${r.owner}/${r.name} is not in factory.yaml repositories`);
    }
  };
  for (const [name, agent] of Object.entries(parsed.agents)) checkRequiredRepos(`agent/${name}`, agent.frontmatter.required_repos);
  for (const [name, au] of Object.entries(parsed.automations)) checkRequiredRepos(`automation/${name}`, au.frontmatter.required_repos);

  if (f?.blueprint) {
    const bp = f.blueprint;
    const stages = new Set(Object.keys(bp.stages));
    if (!stages.has(bp.entry)) err("factory/", ["blueprint", "entry"], "ref", `blueprint entry ${bp.entry} is not a stage`);
    for (const [edge, e] of Object.entries(bp.edges)) {
      if (!stages.has(e.from)) err("factory/", ["blueprint", "edges", edge, "from"], "ref", `edge ${edge} leaves unknown stage ${e.from}`);
      if (!stages.has(e.to)) err("factory/", ["blueprint", "edges", edge, "to"], "ref", `edge ${edge} enters unknown stage ${e.to}`);
    }
    for (const [role, agent] of Object.entries(bp.staffing)) {
      if (!agentNames.has(agent)) err("factory/", ["blueprint", "staffing", role], "ref", `staffing ${role} names unknown agent ${agent}`);
      else if (role === "foreman" && parsed.agents[agent]?.frontmatter.agentType !== "FOREMAN") err("factory/", ["blueprint", "staffing", role], "ref", `staffing foreman must name the FOREMAN agent`);
      else if (role !== "foreman" && !stages.has(role)) err("factory/", ["blueprint", "staffing", role], "ref", `staffing ${role} is not a stage`);
    }
    for (const stage of stages) if (!bp.staffing[stage]) err("factory/", ["blueprint", "staffing"], "required", `stage ${stage} has no staffed agent`);
  }

  for (const [name, s] of Object.entries(parsed.scorers)) {
    for (const [i, ref] of s.frontmatter.agents.entries()) {
      const agent = typeof ref === "string" ? ref : ref.name;
      if (!agentNames.has(agent)) err(`scorer/${name}`, ["agents", i], "ref", `scorer grades unknown agent ${agent}`);
    }
    if (s.frontmatter.runner && !runners.has(s.frontmatter.runner)) err(`scorer/${name}`, ["runner"], "ref", `runner ${s.frontmatter.runner} is not defined in runners/`);
    const values = s.frontmatter.labels.map((l) => l.value);
    if (new Set(values).size !== values.length) err(`scorer/${name}`, ["labels"], "unique", "label values must be unique");
  }

  for (const [name, p] of Object.entries(parsed.pipelines)) {
    const key = `pipeline/${name}`;
    const seen = new Set<string>();
    for (const [i, stage] of p.stages.entries()) {
      if (seen.has(stage.id)) err(key, ["stages", i, "id"], "unique", `stage id ${stage.id} is used twice`);
      if (stage.agent && !agentNames.has(stage.agent)) {
        err(key, ["stages", i, "agent"], "ref", `stage ${stage.id} uses unknown agent ${stage.agent}`);
      }
      if (stage.gate && !gates.has(stage.gate)) {
        err(key, ["stages", i, "gate"], "ref", `stage ${stage.id} uses unknown gate ${stage.gate}`);
      }
      if (stage.on_fail && !seen.has(stage.on_fail)) {
        err(key, ["stages", i, "on_fail"], "ref", `on_fail must name an earlier stage, got ${stage.on_fail}`);
      }
      if (stage.skip_if) {
        try {
          parseExpr(stage.skip_if);
        } catch (e) {
          if (e instanceof ExprError) err(key, ["stages", i, "skip_if"], "expr", `skip_if: ${e.message}`);
          else throw e;
        }
      }
      seen.add(stage.id);
    }
  }

  for (const [name, g] of Object.entries(parsed.gates)) {
    if (g.rule) {
      try {
        parseExpr(g.rule);
      } catch (e) {
        if (e instanceof ExprError) err(`gate/${name}`, ["rule"], "expr", `rule: ${e.message}`);
        else throw e;
      }
    }
  }

  for (const [name, d] of Object.entries(parsed.decisions)) {
    const known = new Set([...Object.keys(d.questions), ...d.state]);
    for (const [action, src] of Object.entries(d.policy)) {
      try {
        for (const ref of refsOf(parseExpr(src))) {
          const [head, option] = ref.split(".");
          const q = d.questions[head!];
          if (!known.has(head!)) {
            err(`decision/${name}`, ["policy", action], "ref", `policy ${action} reads unknown question ${head}`);
          } else if (q?.type === "choice" && option && !q.options.includes(option)) {
            err(`decision/${name}`, ["policy", action], "ref", `${head} has no option ${option}`);
          }
        }
      } catch (e) {
        if (e instanceof ExprError) err(`decision/${name}`, ["policy", action], "expr", `policy ${action}: ${e.message}`);
        else throw e;
      }
    }
  }

  for (const [name, b] of Object.entries(parsed.benchmarks)) {
    const key = `benchmark-suite/${name}`;
    if (!agentNames.has(b.suite.agent)) err(key, ["agent"], "ref", `suite uses unknown agent ${b.suite.agent}`);
    for (const [i, t] of b.suite.tasks.entries()) {
      if (!b.tasks[t]) err(key, ["tasks", i], "ref", `task ${t} has no tasks/${t}.yaml`);
    }
    const names = b.suite.configurations.map((c) => c.name);
    if (new Set(names).size !== names.length) err(key, ["configurations"], "unique", "configuration names must be unique");
  }

  for (const [name, au] of Object.entries(parsed.agents)) {
    for (const skill of Object.keys(au.skills)) {
      if (skills.has(skill)) {
        parsed.warnings.push({
          file: `agents/${name}/skills/${skill}/SKILL.md`,
          line: 1,
          code: "shadow",
          message: `agent skill ${skill} shadows the shared skill with the same name`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors: dedupe(errors), parsed, warnings: parsed.warnings };
  return { ok: true, resolved: resolve(parsed), parsed, warnings: parsed.warnings };
}

function dedupe(errors: DefinitionError[]): DefinitionError[] {
  const seen = new Set<string>();
  return errors
    .filter((e) => {
      const k = `${e.file}:${e.line}:${e.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function formatErrors(errors: DefinitionError[]): string {
  return errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n");
}
