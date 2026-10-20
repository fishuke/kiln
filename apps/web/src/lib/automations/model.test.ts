import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/frontmatter";
import { automationNames, automationPath, parseAutomation, parseTrigger, serializeAutomation, serializeTrigger, triggerSummary } from "./model";

const MD = `---
agent: Kiln Triage Agent
displayName: Check new Linear issues for duplicates
runner: default
secrets: [LINEAR_TOKEN]
triggers:
  - provider: linear
    event: issue_created
    filter:
      teams: [Convozy]
      labels: { not_in: [wip] }
      state_ids: { in: [s1], not_in: [s2] }
  - provider: github
    event: pull_request_ready
    filter:
      repos: [fishuke/klin]
      baseBranches: [main]
      skip_bots: self
      keywords: { not_in: [skip-review] }
      somethingNew: 42
  - provider: schedule
    event: cron_fired
    schedule: { cron: "0 9 * * 1", name: weekly }
  - provider: webhook
    event: received
    filter:
      webhook_ids: [wh_123]
      payload: { data: { level: [fatal] } }
customKey: keep-me
---
Read the new Linear issue.

Search for duplicates.
`;

describe("automation.md round trip", () => {
  it("parses triggers, filters and overrides", () => {
    const a = parseAutomation("dupes", MD);
    expect(a.agent).toBe("Kiln Triage Agent");
    expect(a.enabled).toBe(true);
    expect(a.overrides).toEqual({ runner: "default", secrets: ["LINEAR_TOKEN"] });
    expect(a.extra).toEqual({ customKey: "keep-me" });
    const [linear, gh, sched, hook] = a.triggers;
    expect(linear!.filters.team_ids).toEqual({ key: "teams", in: ["Convozy"] });
    expect(linear!.filters.labels).toEqual({ key: "labels", not_in: ["wip"] });
    expect(linear!.filters.state_ids).toEqual({ key: "state_ids", in: ["s1"], not_in: ["s2"] });
    expect(gh!.filters.base_branches).toEqual({ key: "baseBranches", in: ["main"] });
    expect(gh!.skipBots).toBe("self");
    expect(gh!.unknown).toEqual({ somethingNew: 42 });
    expect(sched!.schedule).toEqual({ cron: "0 9 * * 1", name: "weekly" });
    expect(hook!.webhook).toBe("wh_123");
    expect(hook!.payload).toEqual({ data: { level: ["fatal"] } });
    expect(a.prompt).toBe("Read the new Linear issue.\n\nSearch for duplicates.");
  });

  it("serializes back to the same front matter", () => {
    const a = parseAutomation("dupes", MD);
    const out = serializeAutomation(a);
    expect(parseFrontmatter(out).data).toEqual(parseFrontmatter(MD).data);
    expect(parseAutomation("dupes", out)).toEqual(a);
  });

  it("moves alias exclusions to the canonical key", () => {
    const t = parseTrigger({ provider: "linear", event: "issue_created", filter: { teams: ["A"] } });
    t.filters.team_ids = { key: "teams", not_in: ["A"] };
    expect(serializeTrigger(t)).toEqual({ provider: "linear", event: "issue_created", filter: { team_ids: { not_in: ["A"] } } });
  });

  it("drops empty filters and writes disabled automations", () => {
    const a = parseAutomation("x", "---\ntriggers:\n  - provider: github\n    event: push\n---\n");
    a.triggers[0]!.filters.repos = { key: "repos", in: [] };
    a.enabled = false;
    const data = parseFrontmatter(serializeAutomation(a)).data;
    expect(data).toEqual({ enabled: false, triggers: [{ provider: "github", event: "push" }] });
  });

  it("reads the legacy webhook key", () => {
    expect(parseTrigger({ provider: "webhook", event: "received", filter: { webhook: "ci" } }).webhook).toBe("ci");
  });
});

describe("helpers", () => {
  it("summarizes triggers", () => {
    expect(
      triggerSummary([
        { provider: "github", event: "pull_request_closed" },
        { provider: "github", event: "pull_request_merged" },
      ]),
    ).toBe("GitHub: PR closed, GitHub: PR merged");
    expect(triggerSummary([{ provider: "schedule", event: "cron_fired", schedule: { cron: "0 9 * * 1" } }])).toBe("Weekly on Mon at 9:00 AM");
    expect(triggerSummary([{ provider: "linear", event: "agent_session_created" }])).toBe("Linear: Agent session created");
  });

  it("finds automation files in both layouts", () => {
    const tree = { "automations/a/automation.md": "", "automations/b.md": "", "agents/x/agent.md": "" };
    expect(automationNames(tree)).toEqual(["a", "b"]);
    expect(automationPath(tree, "b")).toBe("automations/b.md");
    expect(automationPath(tree, "c")).toBeUndefined();
  });
});
