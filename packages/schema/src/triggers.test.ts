import { describe, expect, it } from "vitest";
import { parseCron } from "./cron";
import { AutomationFrontmatter, Factory, Webhook } from "./index";
import { TRIGGER_CATALOG, validatePayloadPattern, validateTrigger } from "./triggers";

const msgs = (t: Parameters<typeof validateTrigger>[0]) => validateTrigger(t).map((p) => p.message);

describe("trigger catalogue", () => {
  it("lists every provider and event", () => {
    expect(Object.keys(TRIGGER_CATALOG.github)).toHaveLength(25);
    expect(Object.keys(TRIGGER_CATALOG.azure_devops)).toHaveLength(11);
    expect(Object.keys(TRIGGER_CATALOG.slack)).toEqual(expect.arrayContaining(["member_joined_channel", "message_im", "message_mpim", "reaction_added"]));
    expect(Object.keys(TRIGGER_CATALOG.discord)).toEqual(["app_mention", "slash_command", "message_posted", "reaction_added"]);
  });

  it("rejects unknown events and filter keys", () => {
    expect(msgs({ provider: "github", event: "issue_opened" })[0]).toMatch(/no event issue_opened/);
    expect(msgs({ provider: "github", event: "issue_labeled", filter: { channel_ids: ["C1"] } })[0]).toMatch(/no filter channel_ids/);
    expect(msgs({ provider: "github", event: "pull_request_opened", filter: { labels: { in: ["a"], not_in: ["wip"] }, base_branches: ["main"], pr_numbers: [1, 2] } })).toEqual([]);
  });

  it("checks matcher grammar", () => {
    expect(msgs({ provider: "github", event: "pull_request_merged", filter: { pr_numbers: ["one"] } })[0]).toMatch(/integers/);
    expect(msgs({ provider: "github", event: "issue_labeled", filter: { labels: { any: ["x"] } } })[0]).toMatch(/unknown operator any/);
    expect(msgs({ provider: "github", event: "issue_labeled", filter: { skip_bots: "maybe" } })[0]).toMatch(/all, self or none/);
    expect(msgs({ provider: "schedule", event: "cron_fired", schedule: { cron: "@daily" }, filter: { schedule_ids: ["x"] } })[0]).toMatch(/managed by the server/);
    expect(msgs({ provider: "teams", event: "app_mention", filter: { channel_ids: { in: ["19:abc@thread.tacv2"], not_in: ["x"] } } })[0]).toMatch(/supports only in/);
  });

  it("rejects an alias next to its canonical key and camel next to snake", () => {
    expect(msgs({ provider: "linear", event: "issue_created", filter: { teams: ["Eng"], team_ids: ["t1"] } })[0]).toMatch(/teams or team_ids/);
    expect(msgs({ provider: "github", event: "pull_request_merged", filter: { baseBranches: ["main"], base_branches: ["main"] } })[0]).toMatch(/baseBranches or base_branches/);
    expect(msgs({ provider: "linear", event: "issue_created", filter: { teams: { in: ["Eng"] } } })[0]).toMatch(/plain list/);
  });

  it("rejects gitlab mentioned and enforces Teams ids", () => {
    expect(msgs({ provider: "gitlab", event: "bot_mentioned", filter: { mentioned: ["bot"] } })[0]).toMatch(/managed by the server/);
    expect(msgs({ provider: "teams", event: "app_mention", filter: { team_ids: ["a", "b"] } })[0]).toMatch(/exactly one/);
    expect(msgs({ provider: "teams", event: "app_mention", filter: { channel_ids: ["general"] } })[0]).toMatch(/not a Teams channel id/);
  });

  it("needs exactly one webhook and accepts the legacy webhook key", () => {
    expect(msgs({ provider: "webhook", event: "received" })[0]).toMatch(/webhook_ids/);
    expect(msgs({ provider: "webhook", event: "received", filter: { webhook_ids: ["a", "b"] } })[0]).toMatch(/exactly one/);
    expect(msgs({ provider: "webhook", event: "received", filter: { webhook: "pagerduty" } })).toEqual([]);
    expect(msgs({ provider: "webhook", event: "received", filter: { webhook_ids: { in: ["wh_1"] }, payload: { data: { level: ["fatal"] } } } })).toEqual([]);
  });

  it("validates inline schedules", () => {
    expect(msgs({ provider: "github", event: "push", schedule: { cron: "@daily" } })[0]).toMatch(/only valid on schedule/);
    expect(msgs({ provider: "schedule", event: "cron_fired", schedule: { cron: "TZ=Europe/Amsterdam 0 9 * * 1" } })[0]).toMatch(/UTC/);
    expect(msgs({ provider: "schedule", event: "cron_fired", schedule: { cron: "0 0 9 * * 1" } })[0]).toMatch(/five-field/);
    const twoUnnamed = AutomationFrontmatter.safeParse({
      triggers: [
        { provider: "schedule", event: "cron_fired", schedule: { cron: "@daily" } },
        { provider: "schedule", event: "cron_fired", schedule: { cron: "@hourly" } },
      ],
    });
    expect(twoUnnamed.error?.issues[0]?.message).toMatch(/at most one schedule/);
  });

  it("accepts execution overrides on automations", () => {
    const r = AutomationFrontmatter.safeParse({
      model: "claude-opus-5-5",
      runner: "big",
      environmentId: "env_1",
      secrets: ["NPM_TOKEN"],
      mcpServers: ["sentry"],
      workerHost: "gpu-1",
      idleTimeoutMinutes: 30,
      required_repos: ["acme/docs"],
      triggers: [{ provider: "slack", event: "reaction_added", filter: { emojis: ["ticket"] } }],
    });
    expect(r.error?.issues ?? []).toEqual([]);
  });
});

describe("payload patterns", () => {
  it("accepts nested patterns with operators", () => {
    expect(validatePayloadPattern({ data: { issue: { level: ["fatal", "error"], count: { exists: true }, env: { not_in: ["dev"] } } } })).toEqual([]);
  });

  it("enforces limits and rejects contradictions", () => {
    let deep: Record<string, unknown> = { leaf: ["x"] };
    for (let i = 0; i < 11; i++) deep = { n: deep };
    expect(validatePayloadPattern(deep).join()).toMatch(/deeper than 10/);
    const wide = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, ["v"]]));
    expect(validatePayloadPattern(wide).join()).toMatch(/64 leaf/);
    expect(validatePayloadPattern({ a: Array.from({ length: 33 }, (_, i) => i) }).join()).toMatch(/32 values/);
    expect(validatePayloadPattern({ a: { in: ["x"], not_in: ["x"] } }).join()).toMatch(/both in and not_in/);
    expect(validatePayloadPattern({ a: { in: ["x"], exists: false } }).join()).toMatch(/exists: false/);
    expect(validatePayloadPattern({ a: "x" }).join()).toMatch(/use a list/);
  });
});

describe("factory.yaml integrations", () => {
  const base = { schemaVersion: "kiln/v1", name: "F", repositories: [{ owner: "a", name: "b" }], agentDefaults: { model: "m" } };

  it("normalizes bare names and objects", () => {
    const f = Factory.parse({ ...base, integrations: ["github", "slack", { type: "discord", discord: { autoRespondToThreadReplies: false, guildIds: ["1"] } }] });
    expect(f.integrations).toEqual([{ type: "slack" }, { type: "discord", discord: { autoRespondToThreadReplies: false, guildIds: ["1"] } }]);
  });

  it("keeps Linear and Jira mutually exclusive", () => {
    const r = Factory.safeParse({ ...base, integrations: [{ type: "linear" }, "jira"] });
    expect(r.error?.issues[0]?.message).toMatch(/Linear or Jira/);
  });

  it("rejects settings for another type", () => {
    expect(Factory.safeParse({ ...base, integrations: [{ type: "slack", jira: { projects: ["ENG"] } }] }).success).toBe(false);
  });

  it("accepts cloud providers and github settings", () => {
    const f = Factory.parse({
      ...base,
      github: { factoryConfigChecks: "all" },
      cloudProviders: { aws: { roleArn: "arn:aws:iam::123456789012:role/kiln" }, gcp: { projectNumber: "1234", workloadIdentityFederationPoolId: "pool", workloadIdentityFederationProviderId: "prov" } },
    });
    expect(f.github?.factoryConfigChecks).toBe("all");
    expect(Factory.safeParse({ ...base, cloudProviders: { gcp: { projectNumber: 1234 } } }).success).toBe(false);
  });
});

describe("webhook files", () => {
  it("accepts every signature scheme and rejects credential headers", () => {
    for (const scheme of ["github", "pagerduty", "sentry", "standard_webhooks", "stripe", "vercel"]) {
      expect(Webhook.safeParse({ authMode: "signature", signatureScheme: scheme, secretName: "S" }).success).toBe(true);
    }
    expect(Webhook.safeParse({ authMode: "token", signatureScheme: "github", secretName: "S" }).success).toBe(false);
    expect(Webhook.safeParse({ secretName: "S", deliveryIdHeader: "Authorization" }).success).toBe(false);
  });
});

describe("cron", () => {
  it("parses descriptors and @every", () => {
    expect(parseCron("@daily").next(new Date("2026-10-20T09:00:00Z")).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    const every = parseCron("@every 5m");
    expect(every.everyMs).toBe(300_000);
    expect(every.next(new Date("2026-10-20T09:00:00Z")).toISOString()).toBe("2026-10-20T09:05:00.000Z");
    expect(() => parseCron("@every 10s")).toThrow(/shorter than one minute/);
    expect(() => parseCron("CRON_TZ=UTC 0 * * * *")).toThrow(/UTC/);
    expect(() => parseCron("0 0 * * * *")).toThrow(/six-field/);
  });
});
