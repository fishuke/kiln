import { parse, stringify } from "yaml";
import { splitFrontmatter, type DefinitionTree } from "./tree";

/**
 * Convert a Warp Factories `v1alpha1` definition tree into a Kiln `kiln/v1` tree.
 * Keys Kiln does not support are dropped with a warning so the result validates.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importWarp(tree: DefinitionTree): { tree: DefinitionTree; warnings: string[] } {
  const warnings: string[] = [];
  const out: DefinitionTree = {};
  const drop = (file: string, obj: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      if (k in obj) {
        warnings.push(`${file}: dropped ${k} (not supported by kiln/v1)`);
        delete obj[k];
      }
    }
  };
  const harnessMap: Record<string, string> = { oz: "opencode", claude: "claude-code", "claude-code": "claude-code", codex: "codex" };
  const execution = (file: string, obj: Record<string, unknown>) => {
    drop(file, obj, ["environmentId", "workerHost", "computerUseModel", "credentialStrategy", "required_repos"]);
    if (obj.harness && typeof obj.harness === "object") {
      const h = obj.harness as Record<string, unknown>;
      h.type = harnessMap[String(h.type)] ?? "claude-code";
      drop(file, h, ["auth"]);
    }
    if (typeof obj.model === "string" && /^auto(-|$)/.test(obj.model)) {
      obj.model = "router:auto";
      warnings.push(`${file}: model auto mapped to router:auto (add routers/auto.yaml if missing)`);
    }
    if (obj.mcpServers && !Array.isArray(obj.mcpServers)) obj.mcpServers = Object.keys(obj.mcpServers);
  };
  const frontmatter = (file: string, src: string, fix: (fm: Record<string, unknown>) => void) => {
    const { yaml, body } = splitFrontmatter(src);
    const fm = (parse(yaml) ?? {}) as Record<string, unknown>;
    fix(fm);
    return `---\n${stringify(fm).trimEnd()}\n---\n${body}\n`;
  };

  let usesAuto = false;
  for (const [file, src] of Object.entries(tree)) {
    if (file === "factory.yaml") {
      const f = parse(src) as Record<string, unknown>;
      f.schemaVersion = "kiln/v1";
      f.name = String(f.name ?? "factory");
      f.alias = slug(String(f.alias ?? f.name)).slice(0, 60);
      f.repositories = ((f.repositories as Record<string, unknown>[]) ?? []).map((r) => ({
        forge: String(r.codeForge ?? "GITHUB").toLowerCase() === "gitlab" ? "gitlab" : "github",
        owner: r.owner,
        name: r.name,
        ...(r.deferred ? { deferred: true } : {}),
      }));
      f.integrations = ((f.integrations as { type: string }[]) ?? [])
        .map((i) => i.type)
        .filter((t) => ["slack", "linear", "jira"].includes(t));
      if (f.selfImprovement) {
        const si = f.selfImprovement as Record<string, unknown>;
        f.selfImprovement = {
          ...(si.failedRunThreshold ? { failedRunThreshold: si.failedRunThreshold } : {}),
          reviewers: { type: si.reviewerType ?? "admins", ...(si.reviewerEmails ? { emails: si.reviewerEmails } : {}) },
        };
      }
      const defaults = (f.agentDefaults ?? {}) as Record<string, unknown>;
      execution(file, defaults);
      f.agentDefaults = defaults;
      usesAuto ||= defaults.model === "router:auto";
      drop(file, f, [
        "codeForges",
        "credentialStrategy",
        "automations",
        "benchmarkRepoSubstitutions",
        "secrets",
        "mcpServers",
        "cloudProviders",
        "scorerDefaults",
      ]);
      out[file] = stringify(f);
    } else if (/^agents\/[^/]+\/agent\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => {
        if (fm.agentType === "MAIN") fm.agentType = "FOREMAN";
        execution(file, fm);
        usesAuto ||= fm.model === "router:auto";
      });
    } else if (/^automations\/[^/]+\/automation\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => {
        drop(file, fm, ["idleTimeoutMinutes"]);
        execution(file, fm);
        for (const t of (fm.triggers as Record<string, unknown>[]) ?? []) {
          if (t.provider === "azure_devops" || t.provider === "teams") {
            warnings.push(`${file}: trigger provider ${t.provider} is not supported`);
          }
        }
      });
    } else if (/^runners\/[^/]+\.yaml$/.test(file)) {
      const r = parse(src) as Record<string, unknown>;
      const platform = (r.platform ?? {}) as Record<string, Record<string, unknown> | string>;
      const image = (platform.linux as Record<string, unknown> | undefined)?.dockerImage;
      if (platform.os && platform.os !== "linux") warnings.push(`${file}: ${platform.os} runners are not supported; using linux`);
      out[file] = stringify({
        ...(r.description ? { description: r.description } : {}),
        image: image ?? "ubuntu:24.04",
        ...(r.instanceShape ? { shape: r.instanceShape } : {}),
        setupCommands: r.setupCommands ?? [],
      });
    } else if (/^scorers\/[^/]+\/scorer\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => {
        fm.name ??= file.split("/")[1];
        drop(file, fm, ["output", "runner", "secrets", "mcpServers"]);
        const agents = Array.isArray(fm.agents) ? fm.agents : [fm.agents];
        fm.agents = agents.map((a) => (typeof a === "string" ? a : (a as { name: string }).name));
      });
    } else if (/^benchmarks\/[^/]+\/tasks\/[^/]+\.yaml$/.test(file)) {
      const t = parse(src) as Record<string, unknown>;
      if (typeof t.successCriteria === "string") t.successCriteria = [t.successCriteria];
      drop(file, t, ["linearSeed"]);
      out[file] = stringify(t);
    } else {
      out[file] = src;
    }
  }
  if (usesAuto && !Object.keys(out).some((f) => f === "routers/auto.yaml")) {
    out["routers/auto.yaml"] = stringify({
      type: "complexity",
      default: "claude-sonnet-5-5",
      routing: { easy: "claude-haiku-5-5", hard: "claude-opus-5-5" },
    });
    warnings.push("routers/auto.yaml: added a complexity router to stand in for Warp's auto model");
  }
  return { tree: out, warnings };
}
