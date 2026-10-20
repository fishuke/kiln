/**
 * Smoke test for the real Claude Code harness: one small task in a local sandbox against a
 * git-backed fake forge. Uses your Claude login or CLAUDE_CODE_OAUTH_TOKEN. Run: pnpm smoke:claude
 */
import { FakeJudge, Kiln, sampleTree } from "@kiln/engine";
import { FakeForge } from "@kiln/integrations";

const model = process.env.KILN_SMOKE_MODEL ?? "haiku";
const forge = new FakeForge();
forge.createRepo({ owner: "acme", name: "web" }, { "README.md": "# web\n", "src/greet.ts": "export function greet(name: string) {\n  return `Hello ${name}`;\n}\n" });
const tree = sampleTree();
tree["factory.yaml"] = tree["factory.yaml"]!.replace("harness: { type: claude-code, model: claude-sonnet-5-5 }", `harness: { type: claude-code, model: ${model} }`);
const kiln = new Kiln({ forge, judge: new FakeJudge(() => "meets") });
const applied = kiln.defs.apply(tree, { author: "smoke" });
if (!applied.ok) throw new Error(applied.errors.join("\n"));
const wi = await kiln.workflow.create({ factory: "webapp", title: "Add a farewell function", body: "Add `farewell(name)` to src/greet.ts that returns `Goodbye <name>`.", source: { provider: "api" }, requester: "smoke" });
const started = Date.now();
const run = await kiln.runs.execute({
  factory: "webapp",
  sha: wi.definitionSha,
  agent: "implement",
  workItem: wi,
  branch: "kiln/smoke-farewell",
  prompt: "# Add a farewell function\n\nAdd `farewell(name: string)` to src/greet.ts that returns `Goodbye ${name}`. Keep the change minimal. Commit it, then write .kiln/result.json.",
});
for (const e of kiln.runs.events(run.id)) console.log(`${e.type.padEnd(12)} ${(e.text ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
console.log(`\nstatus=${run.status} cost=$${run.costUsd.toFixed(4)} seconds=${Math.round((Date.now() - started) / 1000)}`);
console.log("result:", JSON.stringify(run.result));
const branch = await forge.readTree({ owner: "acme", name: "web" }, "kiln/smoke-farewell").catch(() => ({}) as Record<string, string>);
console.log("pushed greet.ts:\n" + (branch["src/greet.ts"] ?? "(branch not pushed)"));
process.exit(run.status === "succeeded" && branch["src/greet.ts"]?.includes("farewell") ? 0 : 1);
