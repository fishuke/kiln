import { describe, expect, it } from "vitest";
import { correlationKeys, looksLikeIncident, similarity } from "./dedupe";
import { createTestKiln, sampleTree, waitFor } from "./testing";

const alert = '{"fingerprint":"abc123","status":"firing","labels":{"service":"checkout-api"}}';

describe("deduplication", () => {
  it("derives identity keys from explicit keys, alert payloads, issues, URLs and PRs", () => {
    expect(correlationKeys({ source: { provider: "webhook" }, body: alert, correlationKey: "INC-9" })).toEqual(["key:INC-9", "key:abc123"]);
    expect(
      correlationKeys({ source: { provider: "linear", issueId: "eng-7", url: "https://linear.app/x/ENG-7?foo=1" }, body: "", trackerKey: "ENG-7" }),
    ).toEqual(["issue:ENG-7", "url:https://linear.app/x/ENG-7"]);
    expect(correlationKeys({ source: { provider: "github", repo: "Acme/Web", number: 12 }, body: "" })).toEqual(["gh:acme/web#12"]);
  });

  it("scores salient overlap and recognises incident language", () => {
    const a = similarity("checkout-api returning 502 on /pay", "Customers see 502 errors from checkout-api");
    expect(a.score).toBeGreaterThanOrEqual(0.5);
    expect(a.strong).toContain("502");
    expect(similarity("Add a dark mode toggle", "Rename the billing page").score).toBeLessThan(0.3);
    expect(looksLikeIncident("checkout is down")).toBe(true);
    expect(looksLikeIncident("add a footer link")).toBe(false);
  });

  it("joins a report with the same key to the open task and links its source", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const first = await kiln.workflow.create({
      factory: "webapp",
      title: "Checkout alert",
      body: alert,
      source: { provider: "webhook", automation: "alerts" },
      requester: "alertmanager",
    });
    const again = await kiln.workflow.create({
      factory: "webapp",
      title: "Checkout alert (repeat)",
      body: alert,
      source: { provider: "slack", channel: "C1", thread: "t1" },
      requester: "alice",
    });
    expect(again.deduplicated).toMatchObject({ into: first.id, reason: "key", score: 1 });
    const target = kiln.workflow.get(first.id)!;
    expect(target.linkedSources).toEqual([{ provider: "slack", channel: "C1", thread: "t1" }]);
    expect(target.duplicates).toHaveLength(1);
    expect(target.conversation.at(-1)?.text).toContain("Also reported via slack");
    expect(kiln.workflow.list({ factory: "webapp" })).toHaveLength(1);
  });

  it("matches by content only across sources, and never when dedupe is false", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const first = await kiln.workflow.create({
      factory: "webapp",
      title: "checkout-api 502 errors",
      body: "checkout-api returns 502 on /pay since 10:00",
      source: { provider: "webhook", automation: "alerts" },
      requester: "alertmanager",
    });
    const sameSource = await kiln.workflow.create({
      factory: "webapp",
      title: "checkout-api 502 errors",
      body: "checkout-api returns 502 on /pay again",
      source: { provider: "webhook", automation: "alerts" },
      requester: "alertmanager",
    });
    expect(sameSource.deduplicated).toBeUndefined();
    const forced = await kiln.workflow.create({
      factory: "webapp",
      title: "checkout-api 502",
      body: "checkout-api 502 on /pay",
      source: { provider: "slack", channel: "C3" },
      requester: "bob",
      dedupe: false,
    });
    expect(forced.deduplicated).toBeUndefined();
    const user = await kiln.workflow.create({
      factory: "webapp",
      title: "Checkout broken",
      body: "Customers get 502 from checkout-api when paying on /pay",
      source: { provider: "slack", channel: "C3" },
      requester: "carol",
    });
    expect(user.deduplicated).toMatchObject({ reason: "similarity" });
    expect([first.id, sameSource.id]).toContain(user.deduplicated!.into);
  });

  it("is off when the factory disables it", async () => {
    const tree = sampleTree();
    tree["factory.yaml"] += "deduplication: { enabled: false }\n";
    const { kiln } = createTestKiln({ preview: false, tree });
    await kiln.workflow.create({ factory: "webapp", title: "Alert", body: alert, source: { provider: "webhook" }, requester: "am" });
    const again = await kiln.workflow.create({ factory: "webapp", title: "Alert", body: alert, source: { provider: "slack", channel: "C1" }, requester: "am" });
    expect(again.deduplicated).toBeUndefined();
    expect(kiln.workflow.list({ factory: "webapp" })).toHaveLength(2);
  });

  it("folds a task into another one and cancels it with a link", async () => {
    const { kiln } = createTestKiln({ preview: false });
    const a = await kiln.workflow.create({
      factory: "webapp",
      title: "Fix the footer",
      body: "typo",
      source: { provider: "api" },
      requester: "po@acme.test",
      dedupe: false,
    });
    const b = await kiln.workflow.create({
      factory: "webapp",
      title: "Footer typo",
      body: "typo in footer",
      source: { provider: "slack", channel: "C9" },
      requester: "bob",
      dedupe: false,
    });
    const closed = await kiln.workflow.foldInto(b.id, a.id);
    expect(closed).toMatchObject({ state: "cancelled", duplicateOf: a.id });
    expect(kiln.workflow.get(a.id)!.duplicates?.[0]).toMatchObject({ reason: "triage", workItemId: b.id });
    expect(await kiln.workflow.foldInto(a.id, a.id)).toBeUndefined();
    await waitFor(kiln, b.id, ["cancelled"]);
  });
});
