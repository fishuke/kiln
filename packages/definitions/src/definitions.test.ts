import { describe, expect, it } from "vitest";
import { diffTrees, formatDiff } from "./diff";
import { resolve } from "./resolve";
import { parseTree } from "./parse";
import { treeSha, type DefinitionTree } from "./tree";
import { formatErrors, validateTree } from "./validate";

const base: DefinitionTree = {
  "factory.yaml": `schemaVersion: kiln/v1
name: web-app
alias: webapp
repositories:
  - { owner: acme, name: web-app }
agentDefaults:
  harness: { type: claude-code, model: claude-sonnet-5-5 }
  runner: linux-node
  secrets: [NPM_TOKEN]
defaultPipeline: feature
`,
  "agents/foreman/agent.md": "---\nagentType: FOREMAN\n---\nRoute work.\n",
  "agents/triage/agent.md": "---\nagentType: TRIAGE\nmodel: claude-haiku-5-5\n---\nTriage.\n",
  "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nharness: { type: codex }\nsecrets: null\n---\nBuild.\n",
  "agents/implement/skills/testing/SKILL.md": "---\nname: testing\ndescription: Write tests\n---\nUse vitest.\n",
  "skills/style/SKILL.md": "---\nname: style\ndescription: House style\n---\nNamed exports.\n",
  "automations/labeled/automation.md":
    "---\nagent: implement\nrunner: null\ntriggers:\n  - { provider: github, event: issue_labeled }\n---\nBuild it.\n",
  "automations/to-foreman/automation.md": "---\ntriggers:\n  - { provider: slack, event: app_mention }\nmodel: claude-opus-5-5\n---\n",
  "runners/linux-node.yaml": "image: node:22\n",
  "gates/spec-approval.yaml": "kind: approval\napprovers: [requester]\n",
  "pipelines/feature.yaml":
    "stages:\n  - { id: triage, agent: triage }\n  - { id: build, agent: implement, gate: spec-approval }\n  - { id: verify, agent: implement, on_fail: build }\n",
};

function withFiles(extra: DefinitionTree, omit: string[] = []): DefinitionTree {
  const tree = { ...base, ...extra };
  for (const f of omit) delete tree[f];
  return tree;
}

describe("resolver", () => {
  const resolved = resolve(parseTree(base));

  it("inherits agentDefaults into each agent", () => {
    expect(resolved.agents.foreman).toMatchObject({
      agentType: "FOREMAN",
      harness: { type: "claude-code", model: "claude-sonnet-5-5" },
      runner: "linux-node",
      secrets: ["NPM_TOKEN"],
      skills: ["style"],
    });
  });

  it("a model override keeps the inherited harness and replaces its model", () => {
    expect(resolved.agents.triage!.harness).toEqual({ type: "claude-code", model: "claude-haiku-5-5" });
  });

  it("a harness override replaces harness and model; null clears secrets", () => {
    expect(resolved.agents.implement).toMatchObject({ harness: { type: "codex" }, secrets: [], skills: ["style", "testing"] });
  });

  it("automation overrides apply on top of the agent, and null clears the runner", () => {
    expect(resolved.automations.labeled).toMatchObject({ agent: "implement", harness: { type: "codex" }, runner: undefined });
  });

  it("automations without an agent go to the foreman", () => {
    expect(resolved.automations["to-foreman"]).toMatchObject({
      agent: "foreman",
      harness: { type: "claude-code", model: "claude-opus-5-5" },
    });
  });

  it("matches the resolved snapshot", () => {
    const { parsed: _parsed, ...rest } = resolved;
    expect(rest).toMatchSnapshot();
  });
});

describe("validator", () => {
  it("accepts the base tree", () => {
    const result = validateTree(base);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  const cases: [string, DefinitionTree, string[], string][] = [
    ["missing factory.yaml", {}, ["factory.yaml"], "factory.yaml:1: factory.yaml is required"],
    [
      "unknown runner",
      { "agents/triage/agent.md": "---\nagentType: TRIAGE\nrunner: gpu\n---\n" },
      [],
      "agents/triage/agent.md:3: runner gpu is not defined in runners/",
    ],
    [
      "model and harness together",
      { "agents/triage/agent.md": "---\nagentType: TRIAGE\nmodel: m\nharness: { type: codex }\n---\n" },
      [],
      "agents/triage/agent.md:3: set exactly one of model or harness, not both",
    ],
    [
      "unknown router",
      { "agents/triage/agent.md": "---\nagentType: TRIAGE\nmodel: router:fast\n---\n" },
      [],
      "agents/triage/agent.md:3: router fast is not defined in routers/",
    ],
    [
      "two foremen",
      { "agents/boss/agent.md": "---\nagentType: FOREMAN\n---\n" },
      [],
      "agents/foreman/agent.md:1: a factory needs exactly one FOREMAN agent, found 2",
    ],
    [
      "unknown automation agent",
      { "automations/x/automation.md": "---\nagent: ghost\ntriggers:\n  - { provider: github, event: push }\n---\n" },
      [],
      "automations/x/automation.md:2: agent ghost is not defined in agents/",
    ],
    [
      "unknown pipeline stage agent",
      { "pipelines/feature.yaml": "stages:\n  - { id: a, agent: ghost }\n" },
      [],
      "pipelines/feature.yaml:2: stage a uses unknown agent ghost",
    ],
    [
      "on_fail must point back",
      { "pipelines/feature.yaml": "stages:\n  - { id: a, agent: triage, on_fail: b }\n  - { id: b, agent: triage }\n" },
      [],
      "pipelines/feature.yaml:2: on_fail must name an earlier stage, got b",
    ],
    [
      "bad skip_if",
      { "pipelines/feature.yaml": "stages:\n  - { id: a, agent: triage, skip_if: \"size in\" }\n" },
      [],
      "pipelines/feature.yaml:2: skip_if: unexpected end of expression",
    ],
    [
      "missing default pipeline",
      {},
      ["pipelines/feature.yaml"],
      "factory.yaml:10: pipeline feature is not defined in pipelines/",
    ],
    [
      "scorer on unknown agent",
      {
        "scorers/q/scorer.md":
          "---\nname: q\nagents: [ghost]\nlabels: [{ value: ok, score: 1 }]\npassingScore: 0.5\nmodel: m\n---\nRubric\n",
      },
      [],
      "scorers/q/scorer.md:3: scorer grades unknown agent ghost",
    ],
    [
      "decision reads unknown option",
      {
        "decisions/guard.yaml":
          "state: [command]\nquestions:\n  risk: { type: choice, options: [safe, bad] }\npolicy:\n  block: \"risk.awful > 0.5\"\n",
      },
      [],
      "decisions/guard.yaml:5: risk has no option awful",
    ],
    [
      "schema error carries the line",
      { "runners/linux-node.yaml": "image: node:22\nshape: { vcpus: two, memoryGb: 4 }\n" },
      [],
      "runners/linux-node.yaml:2: shape.vcpus: Invalid input: expected number, received string",
    ],
    [
      "yaml syntax error",
      { "gates/spec-approval.yaml": "kind: approval\napprovers: [requester\n" },
      [],
      "gates/spec-approval.yaml:3: Flow sequence",
    ],
    [
      "benchmark task missing",
      { "benchmarks/core/suite.yaml": "name: core\nagent: implement\nconfigurations: [{ name: a }]\ntasks: [nope]\n" },
      [],
      "benchmarks/core/suite.yaml:4: task nope has no tasks/nope.yaml",
    ],
  ];

  it.each(cases)("%s", (_name, extra, omit, expected) => {
    const result = validateTree(withFiles(extra, omit));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(formatErrors(result.errors)).toContain(expected);
  });

  it("warns about unknown files without failing", () => {
    const result = validateTree(withFiles({ "notes.txt": "hi" }));
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("unknown-file");
  });
});

describe("diff and sha", () => {
  it("reports added, changed and removed resources", () => {
    const after = withFiles(
      { "agents/review/agent.md": "---\nagentType: REVIEW\n---\n", "runners/linux-node.yaml": "image: node:24\n" },
      ["gates/spec-approval.yaml"],
    );
    const diff = diffTrees(base, after);
    expect(diff).toEqual({ added: ["agent/review"], changed: ["runner/linux-node"], removed: ["gate/spec-approval"] });
    expect(formatDiff(diff)).toBe("+ agent/review\n~ runner/linux-node\n- gate/spec-approval");
  });

  it("sha is stable and order independent", () => {
    const reversed = Object.fromEntries(Object.entries(base).reverse());
    expect(treeSha(reversed)).toBe(treeSha(base));
    expect(treeSha(withFiles({ "x.md": "" }))).not.toBe(treeSha(base));
  });
});
