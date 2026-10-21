import type { DefinitionTree } from "@kiln/definitions";
import { FakeChat, FakeForge, FakePreview, FakeTracker } from "@kiln/integrations";
import { fakeAgents } from "./fake-agents";
import { FakeMcpProbe } from "./platform/mcp-probe";
import { Kiln, type KilnOptions } from "./kiln";
import { FakeJudge } from "./scoring";

/** A complete factory definition used by tests, the dev server and the starter template. */
export function sampleTree(extra: DefinitionTree = {}, factory = "web-app", alias = "webapp", repo = "acme/web"): DefinitionTree {
  const [owner, name] = repo.split("/");
  return {
    "factory.yaml": `schemaVersion: kiln/v1
name: ${factory}
alias: ${alias}
project: customer-portal
repositories:
  - { owner: ${owner}, name: ${name} }
integrations: [github, slack, linear]
agentDefaults:
  harness: { type: claude-code, model: claude-sonnet-5-5 }
selfImprovement: { failedRunThreshold: 3, reviewers: { type: team } }
budgets: { perWorkItemUsd: 40 }
`,
    "agents/foreman/agent.md": "---\nagentType: FOREMAN\ndescription: Routes work\n---\nYou coordinate the factory. Ask instead of guessing.\n",
    "agents/triage/agent.md": "---\nagentType: TRIAGE\n---\nClassify and size the request.\n",
    "agents/spec/agent.md": "---\nagentType: SPEC\n---\nWrite a spec with testable acceptance criteria.\n",
    "agents/implement/agent.md": "---\nagentType: IMPLEMENT\n---\nImplement the change with tests.\n",
    "agents/verify/agent.md": "---\nagentType: VERIFY\n---\nVerify each criterion and record a video.\n",
    "agents/review/agent.md": "---\nagentType: REVIEW\n---\nReview adversarially.\n",
    "skills/house-style/SKILL.md": "---\nname: house-style\ndescription: Named exports, zod at boundaries\nowner: platform\nversion: \"2\"\n---\nUse named exports.\n",
    "automations/ready-label/automation.md": "---\ntriggers:\n  - provider: github\n    event: issue_labeled\n    filter: { labels: [kiln-ready] }\n---\nTake the labeled issue through the factory.\n",
    "automations/slack/automation.md": "---\ntriggers:\n  - provider: slack\n    event: app_mention\n---\n",
    "automations/linear/automation.md": "---\ntriggers:\n  - provider: linear\n    event: agent_session_created\n---\n",
    "scorers/criteria/scorer.md":
      "---\nname: criteria\nagents: [implement]\nlabels:\n  - { value: meets, score: 1 }\n  - { value: misses, score: 0 }\npassingScore: 1\nsamplingRate: 25\nmodel: claude-haiku-5-5\nselfImprovement: true\n---\nDoes the change meet every acceptance criterion?\n",
    ...extra,
  };
}

export type TestKiln = { kiln: Kiln; forge: FakeForge; tracker: FakeTracker; chat: FakeChat; preview: FakePreview };

export function createTestKiln(opts: Omit<Partial<KilnOptions>, "preview"> & { tree?: DefinitionTree; preview?: boolean | FakePreview; repo?: string } = {}): TestKiln {
  const forge = (opts.forge as FakeForge | undefined) ?? new FakeForge();
  const [owner, name] = (opts.repo ?? "acme/web").split("/");
  forge.createRepo({ owner: owner!, name: name! }, { "README.md": "# web\n", "package.json": '{ "name": "web" }\n' });
  const tracker = (opts.tracker as FakeTracker | undefined) ?? new FakeTracker("linear");
  const chat = (opts.chat as FakeChat | undefined) ?? new FakeChat();
  const preview = opts.preview instanceof FakePreview ? opts.preview : new FakePreview();
  const { tree, preview: wantPreview, repo, ...rest } = opts;
  const kiln = new Kiln({
    harness: fakeAgents(),
    judge: new FakeJudge(() => "meets"),
    mcpProbe: new FakeMcpProbe(),
    roles: { po: ["po@acme.test"], "code-owners": ["lead@acme.test"], admins: ["admin@acme.test"] },
    askHumanTimeoutMs: 2000,
    ...rest,
    forge,
    tracker,
    chat,
    preview: wantPreview === false ? undefined : preview,
  });
  const result = kiln.defs.apply(tree ?? sampleTree({}, "web-app", "webapp", repo), { author: "test" });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return { kiln, forge, tracker, chat, preview };
}

/** Wait until the work item reaches one of the states (the workflow runs in the background). */
export async function waitFor(kiln: Kiln, id: string, states: string[], timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const wi = kiln.workflow.get(id);
    if (wi && states.includes(wi.state)) return wi;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${states.join("|")}; state is ${wi?.state} (${wi?.blockedReason ?? ""})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
