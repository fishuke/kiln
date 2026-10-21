import { FakeHarness, type FakeScriptContext, type HarnessAdapter } from "@kiln/harness";
import { MarkdownPlanner } from "./planning";

const COST: Record<string, number> = { TRIAGE: 0.04, FOREMAN: 0.02, SPEC: 0.35, IMPLEMENT: 1.2, VERIFY: 0.3, REVIEW: 0.25, PLAN: 0.5, CUSTOM: 0.15 };

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "change";
}

function criteriaFrom(text: string): string[] {
  const acs = [...text.matchAll(/^\s*-\s*(?:\[[ x]\]\s*)?(AC\d+:.+)$/gm)].map((m) => m[1]!.trim());
  if (acs.length) return [...new Set(acs)];
  const body = text.split("\n").slice(1).join("\n");
  const bullets = [...body.matchAll(/^\s*[-*]\s+(.{8,})$/gm)].map((m) => m[1]!.trim()).filter((b) => !/^(Triage|Automation)/.test(b)).slice(0, 5);
  const base = bullets.length ? bullets : ["The change works end to end for the user", "The change is covered by an automated test"];
  return base.map((b, i) => `AC${i + 1}: ${b.replace(/\b(maybe|somehow|etc\.?)\b/gi, "").replace(/\s+/g, " ").trim()}`);
}

/**
 * Deterministic stand-ins for every agent role, used for local development without model keys and
 * for end-to-end tests. They behave like real agents: read the brief, edit files in the sandbox,
 * run (guarded) git commands, and report through .kiln/result.json.
 */
export async function fakeAgentScript(ctx: FakeScriptContext): Promise<{ summary: string; costUsd: number }> {
  const { opts } = ctx;
  const type = opts.env?.KILN_AGENT_TYPE ?? "CUSTOM";
  const p = (x: string) => (opts.cwd ? `${opts.cwd}/${x}` : x);
  const sh = (cmd: string) => opts.sandbox.exec(cmd, { cwd: opts.cwd });
  const result = (obj: unknown) => opts.sandbox.writeFile(p(".kiln/result.json"), JSON.stringify(obj, null, 2));
  const title = opts.prompt.split("\n")[0]!.replace(/^#\s*/, "");
  const prompt = opts.prompt;
  const wi = opts.env?.KILN_WORK_ITEM || "adhoc";
  ctx.emit({ type: "message", text: `${type.toLowerCase()} agent picked up: ${title}` });
  const model = opts.model ?? "";
  const cost = Math.round((COST[type] ?? 0.1) * (/haiku/.test(model) ? 0.2 : /opus|fable/.test(model) ? 3 : 1) * 1000) / 1000;
  if (/\[hard\]/.test(prompt) && /haiku/.test(model)) throw new Error("this task is too hard for the small model");

  switch (type) {
    case "TRIAGE": {
      const kind = /\b(bug|fix|crash|error|broken|regression)\b/i.test(prompt) ? "bug" : /\b(chore|bump|upgrade|rename)\b/i.test(prompt) ? "chore" : "feature";
      const size = /\b(large|epic|redesign|platform|migration)\b/i.test(prompt) ? "l" : prompt.split("\n").length > 14 ? "m" : "s";
      await result({ kind, size, summary: `${kind} of size ${size}: ${title}` });
      return { summary: `Triaged as ${kind}/${size}`, costUsd: cost };
    }
    case "FOREMAN": {
      const stage = /\b(spec|ambiguous|unclear|large|design)\b/i.test(prompt) || /"size":"(m|l|xl)"/.test(prompt.replace(/\s/g, "")) ? "spec" : "build";
      await result({ dispatch: { stage, agent: stage, context: title } });
      return { summary: `Dispatching ${stage}`, costUsd: cost };
    }
    case "SPEC": {
      const criteria = criteriaFrom(prompt);
      const specPath = `docs/specs/${wi}.md`;
      await opts.sandbox.writeFile(p(specPath), [`# Spec: ${title}`, "", "## Why", `People asked for this: ${title}`, "", "## Acceptance criteria", ...criteria.map((c) => `- ${c}`), ""].join("\n"));
      const r = await sh(`git add -A && git commit -q --allow-empty -m "spec: ${slug(title)}"`);
      if (r.code !== 0) throw new Error(`commit failed: ${r.stderr}`);
      await result({ specPath, why: `People asked for this: ${title}`, goal: `${title} works end to end`, approach: "Change the smallest part of the code that delivers it", criteria, stories: criteria.map((c) => `As a user, ${c.replace(/^AC\d+:\s*/, "").toLowerCase()}`), openQuestions: [] });
      return { summary: `Wrote ${specPath} with ${criteria.length} criteria`, costUsd: cost };
    }
    case "IMPLEMENT": {
      if (/\[fail-implement\]/.test(prompt)) throw new Error("could not build the change");
      if (/\[no-change\]/.test(prompt)) {
        await result({ summary: "Checked it: nothing in the code needs to change." });
        return { summary: "Checked it: nothing in the code needs to change.", costUsd: cost };
      }
      const waitMs = Number(opts.env?.KILN_FAKE_STEER_WAIT_MS ?? process.env.KILN_FAKE_STEER_WAIT_MS ?? 0);
      const steer = waitMs ? await ctx.nextSteer(waitMs) : undefined;
      const conventions = [...opts.instructions.matchAll(/^- Convention: ([^.]+)\./gm)].map((m) => m[1]!.trim());
      const name = slug(/Implement this user story now: (.+)/.exec(prompt)?.[1] ?? title);
      const file = `src/kiln/${name}.ts`;
      const header = [...conventions.map((c) => `// convention: ${c}`), ...(steer ? [`// steered: ${steer}`] : [])];
      await opts.sandbox.writeFile(p(file), [...header, `export function ${name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^[0-9]/, "f$&")}() {`, `  return ${JSON.stringify(title)};`, "}", ""].join("\n"));
      await opts.sandbox.writeFile(p(`src/kiln/${name}.test.ts`), `import { test } from "node:test";\ntest(${JSON.stringify(title)}, () => {});\n`);
      if (/Review findings to address/.test(prompt)) await opts.sandbox.writeFile(p(`src/kiln/${name}.review.md`), "Addressed review findings.\n");
      const r = await sh(`git add -A && (git diff --cached --quiet || git commit -q -m "feat: ${name}")`);
      if (r.code !== 0) throw new Error(`commit failed: ${r.stderr}`);
      const remember = /remember:\s*(.+)/i.exec(prompt)?.[1];
      await result({ summary: `Implemented ${file}`, testsPassed: true, ...(remember ? { memories: [{ title: remember.trim(), body: `Learned while building "${title}".` }] } : {}) });
      return { summary: steer ? `Implemented ${file}; next action used the steering note` : `Implemented ${file}`, costUsd: cost };
    }
    case "VERIFY": {
      const ids = [...new Set([...prompt.matchAll(/\b(AC\d+)\b/g)].map((m) => m[1]!))];
      const failing = /\[fail-verify\]/.test(prompt) && !/back to build/i.test(prompt);
      const specs = (ids.length ? ids : ["AC1"]).map((id) => ({
        title: `${id}: verified in the browser`,
        tests: [{ results: [{ status: failing ? "failed" : "passed", duration: 1000, attachments: [{ name: "video", contentType: "video/webm", path: `test-results/${id}/video.webm` }] }] }],
      }));
      for (const s of specs) await opts.sandbox.writeFile(p(s.tests[0]!.results[0]!.attachments[0]!.path), `fake-webm ${s.title}`);
      await opts.sandbox.writeFile(p("playwright-report/results.json"), JSON.stringify({ suites: [{ title: "acceptance.spec.ts", specs }] }));
      await result({ testsPassed: !failing, playwrightReport: "playwright-report/results.json" });
      return { summary: failing ? "Verification failed" : `Verified ${specs.length} criteria with videos`, costUsd: cost };
    }
    case "REVIEW": {
      const addressed = (await sh("ls src/kiln/*.review.md 2>/dev/null")).stdout.trim() !== "";
      const wantsChanges = /\[needs-changes\]/.test(prompt) && !addressed;
      const needsHuman = /\[needs-human\]/.test(prompt);
      await result(
        wantsChanges
          ? { verdict: "changes_requested", findings: ["src/kiln: missing input validation — add a guard and a test"] }
          : needsHuman
            ? { verdict: "needs_human", findings: ["Product decision: should this be behind a flag?"] }
            : { verdict: "accepted", findings: [] },
      );
      return { summary: wantsChanges ? "Changes requested" : "Accepted", costUsd: cost };
    }
    case "PLAN": {
      const factories = /Target factories: (.+)/.exec(prompt)?.[1]?.split(",").map((s) => s.trim()) ?? [];
      const prd = /PRD:\n([\s\S]*?)(\n\n(Notes|Target factories):|$)/.exec(prompt)?.[1] ?? prompt;
      const epics = await new MarkdownPlanner().plan({ goal: title, prd, factories });
      await result({ epics });
      return { summary: `Planned ${epics.length} epic(s)`, costUsd: cost };
    }
    default: {
      await result({ summary: `Handled: ${title}` });
      return { summary: `Handled: ${title}`, costUsd: cost };
    }
  }
}

export function fakeAgents(): (type: string, agentType: string) => HarnessAdapter {
  const harness = new FakeHarness(fakeAgentScript);
  return () => harness;
}
