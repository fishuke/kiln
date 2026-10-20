import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { diffTrees, formatDiff, formatErrors, importWarp, loadTree, validateTree, writeTree } from "@kiln/definitions";
import { jsonSchemaFor, type FileKind } from "@kiln/schema";
import { KilnApiError, KilnClient } from "@kiln/sdk-ts";

export type CliIO = { out: (s: string) => void; err: (s: string) => void; cwd: string; env: NodeJS.ProcessEnv; client?: KilnClient };

const TEMPLATES = fileURLToPath(new URL("../../../factories/templates/", import.meta.url));

export const HELP = `kiln — self-hostable software factories

Definitions (local)
  kiln init [dir] [--template sdlc|single-repo|po-feature|incident]   Scaffold a definition tree
  kiln validate [path]                                                Schema and reference checks; exit 1 on errors
  kiln diff [path] [--against <path>] [--factory <id>]                What an apply would change
  kiln import --from-warp <src> [out]                                 Convert a Warp v1alpha1 tree
  kiln schema <kind>                                                  JSON Schema for a file kind

Factory (needs KILN_URL and KILN_TOKEN)
  kiln apply [path] [--dry-run] [--canary 10%] [--factory <id>]       Apply atomically, or as a canary
  kiln connect <owner/repo> [--dir <path>] [--ref main]               Store a factory in a GitHub config repo
  kiln factories                                                      List factories
  kiln send "<task>" --factory <id> [--body <text>]                   Create a work item
  kiln pull <task>                                                    Take a task to a local worktree
  kiln handback <task> [message]                                      Return it to the factory
  kiln runs [--factory <id>] [--work-item <id>]                       List runs
  kiln inbox [--all]                                                  Decisions waiting on you
  kiln decide <gate> approve|reject|answer [text]                     Decide a gate
  kiln replay <run> [--with <sha>]                                    Replay a run, optionally under another definition
  kiln steer <run> <message>                                          Steer a running agent
  kiln bench run <suite> --factory <id>                               Run a benchmark suite
  kiln metrics --factory <id> [--since <iso>]                         Factory metrics
  kiln token create --name <n> --subject <email> --grants read:*,send:webapp
`;

function config(io: CliIO): { url: string; token?: string } {
  const file = join(homedir(), ".kiln", "config.json");
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { url?: string; token?: string }) : {};
  return { url: io.env.KILN_URL ?? saved.url ?? "http://localhost:4000", token: io.env.KILN_TOKEN ?? saved.token };
}

function client(io: CliIO) {
  if (io.client) return io.client;
  const c = config(io);
  return new KilnClient({ baseUrl: c.url, token: c.token });
}

const table = (rows: string[][]) => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd()).join("\n");
};

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      template: { type: "string" },
      against: { type: "string" },
      factory: { type: "string" },
      "dry-run": { type: "boolean" },
      canary: { type: "string" },
      "from-warp": { type: "string" },
      body: { type: "string" },
      "work-item": { type: "string" },
      all: { type: "boolean" },
      with: { type: "string" },
      since: { type: "string" },
      dir: { type: "string" },
      ref: { type: "string" },
      name: { type: "string" },
      subject: { type: "string" },
      grants: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const str = (k: string) => values[k] as string | undefined;
  const path = (p?: string) => resolve(io.cwd, p ?? ".");
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "--help":
        io.out(HELP);
        return 0;
      case "init": {
        const template = str("template") ?? "sdlc";
        const src = join(TEMPLATES, template);
        if (!existsSync(src)) {
          io.err(`unknown template ${template}`);
          return 1;
        }
        const dest = path(positionals[0]);
        if (existsSync(join(dest, "factory.yaml"))) {
          io.err(`${dest}/factory.yaml already exists`);
          return 1;
        }
        mkdirSync(dest, { recursive: true });
        writeTree(dest, loadTree(src));
        io.out(`Created a ${template} factory in ${dest}. Edit factory.yaml, then run kiln validate.`);
        return 0;
      }
      case "validate": {
        const result = validateTree(loadTree(path(positionals[0])));
        for (const w of result.warnings) io.err(`warning ${w.file}:${w.line}: ${w.message}`);
        if (!result.ok) {
          io.err(formatErrors(result.errors));
          return 1;
        }
        io.out(`ok ${result.resolved.factory.name} (${result.resolved.sha.slice(0, 12)}): ${Object.keys(result.resolved.agents).length} agents, ${Object.keys(result.resolved.automations).length} automations`);
        return 0;
      }
      case "diff": {
        const tree = loadTree(path(positionals[0]));
        if (str("against")) {
          io.out(formatDiff(diffTrees(loadTree(path(str("against"))), tree)));
          return 0;
        }
        const factory = str("factory") ?? validateTree(tree).parsed.factory?.alias;
        if (!factory) throw new Error("pass --factory or --against");
        const d = await client(io).diff(factory, tree);
        io.out(formatDiff(d));
        return 0;
      }
      case "import": {
        const src = str("from-warp");
        if (!src) throw new Error("usage: kiln import --from-warp <src> [out]");
        const { tree, warnings } = importWarp(loadTree(path(src)));
        const out = path(positionals[0] ?? `${src.replace(/\/$/, "")}-kiln`);
        writeTree(out, tree);
        for (const w of warnings) io.err(`warning ${w}`);
        const result = validateTree(tree);
        io.out(result.ok ? `Imported to ${out}; it validates.` : `Imported to ${out} with errors:\n${formatErrors(result.errors)}`);
        return result.ok ? 0 : 1;
      }
      case "schema":
        io.out(JSON.stringify(jsonSchemaFor((positionals[0] ?? "factory") as FileKind), null, 2));
        return 0;
      case "apply": {
        const tree = loadTree(path(positionals[0]));
        const local = validateTree(tree);
        if (!local.ok) {
          io.err(formatErrors(local.errors));
          return 1;
        }
        const canary = str("canary") ? Number(str("canary")!.replace("%", "")) : undefined;
        const r = await client(io).apply(tree, { factory: str("factory"), canaryPercent: canary, dryRun: Boolean(values["dry-run"]) });
        if (!r.ok) {
          io.err(r.errors.join("\n"));
          return 1;
        }
        io.out(`${r.dryRun ? "Would apply" : canary ? `Applied as a ${canary}% canary` : "Applied"} ${r.factory} @ ${r.sha.slice(0, 12)}\n${formatDiff(r.diff)}`);
        return 0;
      }
      case "connect": {
        const [owner, name] = (positionals[0] ?? "").split("/");
        if (!owner || !name) throw new Error("usage: kiln connect <owner/repo>");
        const r = await client(io).connect({ owner, name, dir: str("dir"), ref: str("ref") });
        io.out(r.ok ? `Connected ${r.factory} to ${owner}/${name}; merges to ${str("ref") ?? "main"} apply automatically.` : r.errors.join("\n"));
        return r.ok ? 0 : 1;
      }
      case "factories": {
        const fs = await client(io).factories();
        io.out(table([["ID", "NAME", "SHA", "REPO", "OPEN GATES"], ...fs.map((f) => [f.id, f.name, (f.appliedSha ?? "").slice(0, 10) + (f.canary ? ` (+${f.canary.percent}% canary)` : ""), f.definitionRepo ? `${f.definitionRepo.owner}/${f.definitionRepo.name}` : "managed", String(f.openGates)])]));
        return 0;
      }
      case "send": {
        const factory = str("factory");
        if (!factory || !positionals[0]) throw new Error('usage: kiln send "<task>" --factory <id>');
        const wi = await client(io).send({ factory, title: positionals[0], body: str("body") ?? "", via: "kiln" });
        io.out(`Created ${wi.id} in ${factory}. Follow it with: kiln runs --work-item ${wi.id}`);
        return 0;
      }
      case "pull": {
        const id = positionals[0];
        if (!id) throw new Error("usage: kiln pull <task>");
        const p = await client(io).pull(id);
        const dir = path(`kiln-${id}`);
        execFileSync("git", ["clone", "-q", p.cloneUrl, dir], { stdio: "pipe" });
        execFileSync("git", ["checkout", "-q", "-B", p.branch, ...(remoteHas(dir, p.branch) ? [`origin/${p.branch}`] : [])], { cwd: dir, stdio: "pipe" });
        writeFileSync(join(dir, ".kiln-task.md"), `${p.brief}\n`);
        io.out(`Checked out ${p.branch} in ${dir}. The brief is in .kiln-task.md. Hand it back with: kiln handback ${id} "what you did"`);
        return 0;
      }
      case "handback": {
        const id = positionals[0];
        if (!id) throw new Error("usage: kiln handback <task> [message]");
        await client(io).handback(id, positionals.slice(1).join(" ") || "done locally");
        io.out(`Handed ${id} back to the factory.`);
        return 0;
      }
      case "runs": {
        const runs = await client(io).runs({ factory: str("factory"), workItem: str("work-item"), limit: 50 });
        io.out(table([["RUN", "AGENT", "STATUS", "COST", "STARTED"], ...runs.map((r) => [r.id, r.agent, r.status, `$${r.costUsd.toFixed(2)}`, r.startedAt.slice(0, 19)])]));
        return 0;
      }
      case "inbox": {
        const items = await client(io).inbox({ all: Boolean(values.all) });
        if (!items.length) io.out("Nothing is waiting on you.");
        else io.out(table([["GATE", "KIND", "TITLE", "OPENED"], ...items.map((g) => [g.id, g.kind, g.title, g.openedAt.slice(0, 16)])]));
        return 0;
      }
      case "decide": {
        const [gate, decision, ...text] = positionals;
        if (!gate || !["approve", "reject", "answer"].includes(decision ?? "")) throw new Error("usage: kiln decide <gate> approve|reject|answer [text]");
        const g = await client(io).decide(gate, decision as "approve", text.join(" ") || undefined, "cli");
        io.out(`${g.title}: ${g.state}`);
        return 0;
      }
      case "replay": {
        if (!positionals[0]) throw new Error("usage: kiln replay <run> [--with <sha>]");
        const r = await client(io).replay(positionals[0], str("with"));
        io.out(`Replay ${r.id}: ${r.status} (definition ${r.definitionSha.slice(0, 12)})`);
        return r.status === "succeeded" ? 0 : 1;
      }
      case "steer": {
        const [run, ...text] = positionals;
        if (!run || !text.length) throw new Error("usage: kiln steer <run> <message>");
        await client(io).steer(run, text.join(" "));
        io.out("Sent.");
        return 0;
      }
      case "bench": {
        const [sub, suite] = positionals;
        const factory = str("factory");
        if (sub !== "run" || !suite || !factory) throw new Error("usage: kiln bench run <suite> --factory <id>");
        const r = await client(io).runBenchmark(factory, suite);
        io.out(table([["CONFIG", "SUCCESS", "AVG COST", "PARETO"], ...r.summary.map((s) => [s.configuration, `${Math.round(s.successRate * 100)}%`, `$${s.avgCostUsd.toFixed(3)}`, s.pareto ? "yes" : ""])]));
        return 0;
      }
      case "metrics": {
        const factory = str("factory");
        if (!factory) throw new Error("usage: kiln metrics --factory <id>");
        const m = await client(io).metrics(factory, { since: str("since") });
        io.out(values.json ? JSON.stringify(m, null, 2) : `PRs opened ${m.prsOpened}, merged ${m.prsMerged}, autonomy ${Math.round(m.autonomy * 100)}%, cycle time ${m.cycleTimeHoursMedian ?? "–"}h, cost $${m.costUsd} ($${m.costPerMergedPrUsd ?? "–"} per merged PR)`);
        return 0;
      }
      case "token": {
        if (positionals[0] !== "create") throw new Error("usage: kiln token create --name <n> --subject <email> --grants read:*,send:webapp");
        const grants = (str("grants") ?? "read:*").split(",").map((g) => {
          const parts = g.split(":");
          const factory = parts.pop()!;
          return { scope: parts.join(":"), factory };
        });
        const r = await client(io).issueToken({ name: str("name") ?? "cli", subject: str("subject") ?? "cli", grants });
        io.out(r.token);
        return 0;
      }
      default:
        io.err(`unknown command ${cmd}\n\n${HELP}`);
        return 1;
    }
  } catch (err) {
    if (err instanceof KilnApiError) io.err(`error ${err.status}: ${err.message}`);
    else io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function remoteHas(dir: string, branch: string) {
  try {
    return execFileSync("git", ["ls-remote", "origin", `refs/heads/${branch}`], { cwd: dir, stdio: "pipe" }).toString().trim() !== "";
  } catch {
    return false;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.cwd(), env: process.env }).then((code) => process.exit(code));
}
