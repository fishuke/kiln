import { parse, stringify } from "yaml";
import { splitFrontmatter, type DefinitionTree } from "./tree";

/**
 * Convert a `v1alpha1` factory definition tree into a `kiln/v1` tree.
 * Keys Kiln does not support are dropped with a warning so the result validates.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importV1alpha1(tree: DefinitionTree): { tree: DefinitionTree; warnings: string[] } {
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
  const harnessMap: Record<string, string> = { oz: "opencode", claude: "claude-code", "claude-code": "claude-code", codex: "codex", gemini: "gemini", pi: "pi" };
  const execution = (file: string, obj: Record<string, unknown>, keepOverrides = false) => {
    // workerHost, computerUseModel, required_repos and (on agents) credentialStrategy are kiln/v1 keys too.
    if (keepOverrides) drop(file, obj, ["credentialStrategy"]);
    if (Array.isArray(obj.required_repos)) {
      obj.required_repos = obj.required_repos.map((r) => (typeof r === "string" ? r : `${(r as { owner: string }).owner}/${(r as { name: string }).name}`));
    }
    if (obj.harness && typeof obj.harness === "object") {
      const h = obj.harness as Record<string, unknown>;
      h.type = harnessMap[String(h.type)] ?? "claude-code";
      const auth = h.auth as { source?: string; secretName?: string } | undefined;
      if (auth?.source === "managedSecret" && auth.secretName) h.auth = { source: "secret", secretName: auth.secretName };
      else if (auth?.source === "workerEnvironment") h.auth = { source: "worker" };
      else delete h.auth;
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
      // Aliases keep their case and spaces; characters Kiln does not allow become dashes.
      f.alias = String(f.alias ?? f.name).replace(/[^A-Za-z0-9 ._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || slug(String(f.name));
      if (f.scorerDefaults && typeof f.scorerDefaults === "object") {
        const sd = f.scorerDefaults as Record<string, unknown>;
        if (sd.mcpServers && !Array.isArray(sd.mcpServers)) sd.mcpServers = Object.keys(sd.mcpServers);
        drop(file, sd, ["environmentId"]);
      }
      const primary = String(((f.codeForges as string[] | undefined) ?? ["GITHUB"])[0] ?? "GITHUB").toLowerCase();
      f.repositories = ((f.repositories as Record<string, unknown>[]) ?? []).map((r) => ({
        forge: String(r.codeForge ?? primary).toLowerCase(),
        owner: r.owner,
        name: r.name,
        ...(r.deferred ? { deferred: true } : {}),
      }));
      // Keep each integration's settings; legacy teamIds/projectKeys are accepted and kept as-is.
      const simple = (i: Record<string, unknown>) => Object.keys(i).length === 1;
      f.integrations = ((f.integrations as Record<string, unknown>[]) ?? [])
        .filter((i) => ["slack", "linear", "jira", "microsoft-teams", "discord"].includes(String(i.type)))
        .map((i) => (simple(i) ? String(i.type) : i));
      if (f.providers && !f.cloudProviders) {
        f.cloudProviders = f.providers;
        warnings.push(`${file}: providers renamed to cloudProviders`);
      }
      delete f.providers;
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
      drop(file, f, ["codeForges", "benchmarkRepoSubstitutions", "secrets", "mcpServers"]);
      out[file] = stringify(f);
    } else if (/^agents\/[^/]+\/agent\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => {
        if (fm.agentType === "MAIN") fm.agentType = "FOREMAN";
        execution(file, fm);
        usesAuto ||= fm.model === "router:auto";
      });
    } else if (/^automations\/[^/]+\/automation\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => {
        execution(file, fm, true);
      });
    } else if (/^automations\/[^/]+\.md$/.test(file)) {
      out[file] = frontmatter(file, src, (fm) => execution(file, fm, true));
    } else if (/^runners\/[^/]+\.yaml$/.test(file)) {
      const r = parse(src) as Record<string, unknown>;
      const platform = (r.platform ?? {}) as Record<string, Record<string, unknown> | string>;
      const image = (platform.linux as Record<string, unknown> | undefined)?.dockerImage;
      const linux = !platform.os || platform.os === "linux";
      if (!linux) warnings.push(`${file}: ${platform.os} runners are not supported; using linux`);
      out[file] = stringify({
        ...(r.description ? { description: r.description } : {}),
        image: image ?? "ubuntu:24.04",
        ...(linux && r.platform ? { platform: r.platform } : {}),
        ...(r.instanceShape ? { shape: r.instanceShape } : {}),
        ...(r.failureSessionRetentionMinutes ? { failureSessionRetentionMinutes: r.failureSessionRetentionMinutes } : {}),
        setupCommands: ((r.setupCommands as unknown[]) ?? []).filter((c) => typeof c === "string"),
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
    warnings.push("routers/auto.yaml: added a complexity router to stand in for the auto model");
  }
  return { tree: out, warnings };
}
