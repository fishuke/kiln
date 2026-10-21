import { describe, expect, it } from "vitest";
import { buildInbox, canRetrySpec, inboxCount, filterInbox, gateEntry, INBOX_KINDS, primaryAction, questionOptions, questionPrompt, retryModel, type GateLike } from "./inbox-model";

const gate = (over: Partial<GateLike> = {}): GateLike => ({ id: "g1", workItemId: "wi_1", factory: "kiln", kind: "spec", title: "Approve the spec", state: "open", evidence: [], openedAt: "2026-10-20T10:00:00Z", assignees: [], ...over });

describe("questionOptions", () => {
  it("reads structured options", () => {
    expect(questionOptions({ options: ["A", { label: "B", recommended: true }] })).toEqual([{ label: "A" }, { label: "B", recommended: true }]);
  });
  it("reads a Markdown list with a recommended marker", () => {
    const q = "Which database?\n\n- Postgres (recommended)\n- SQLite\n";
    expect(questionOptions({ question: q })).toEqual([{ label: "Postgres", recommended: true }, { label: "SQLite" }]);
    expect(questionPrompt(q)).toBe("Which database?");
  });
  it("needs at least two options", () => {
    expect(questionOptions({ question: "Why?\n- only one" })).toEqual([]);
  });
});

describe("inboxCount", () => {
  it("skips resolved gates and counts blocked work without a gate, like the inbox page", () => {
    const stuck = [{ id: "wi_9", factory: "kiln", title: "y", state: "blocked", updatedAt: "2026-10-20T09:00:00Z" }];
    expect(inboxCount([gate({ resolved: true })], [])).toBe(0);
    expect(inboxCount([gate({ resolved: true })], stuck)).toBe(1);
    expect(inboxCount([gate()], stuck)).toBe(2);
  });
});

describe("buildInbox", () => {
  it("maps gate kinds and hides blocked work that already has a gate", () => {
    const entries = buildInbox(
      [gate(), gate({ id: "g2", kind: "preview", workItemId: "wi_2", evidence: [{ label: "Preview", url: "https://p" }] }), gate({ id: "g3", kind: "question", state: "answered", workItemId: "wi_3" })],
      [
        { id: "wi_1", factory: "kiln", title: "x", state: "blocked", updatedAt: "2026-10-20T09:00:00Z" },
        { id: "wi_9", factory: "kiln", title: "y", state: "failed", updatedAt: "2026-10-20T09:00:00Z" },
        { id: "wi_8", factory: "kiln", title: "z", state: "building", updatedAt: "2026-10-20T09:00:00Z" },
      ],
    );
    expect(entries.map((e) => e.kind).sort()).toEqual(["answer_question", "failed", "pr_review", "spec_review"]);
    expect(entries.find((e) => e.gateId === "g2")!.previewUrl).toBe("https://p");
  });

  it("uses the API's inbox item ids and kinds", () => {
    const entries = buildInbox([gate(), gate({ id: "g3", kind: "question", state: "answered", workItemId: "wi_3" })], [{ id: "wi_9", factory: "kiln", title: "y", state: "failed", updatedAt: "2026-10-20T09:00:00Z" }]);
    expect(entries.map((e) => [e.id, e.kind]).sort()).toEqual([
      ["answer:g3", "answer_question"],
      ["g1", "spec_review"],
      ["task:wi_9:failed", "failed"],
    ]);
    expect(INBOX_KINDS).toEqual(["question", "answer_question", "spec_review", "pr_review", "blocked", "failed"]);
  });

  it("filters by read state, kind, factory and text", () => {
    const entries = [gateEntry(gate({ read: true })), gateEntry(gate({ id: "g2", kind: "question", factory: "shop", title: "Pick a color" }))];
    expect(filterInbox(entries, { read: ["unread"] }).map((e) => e.id)).toEqual(["g2"]);
    expect(filterInbox(entries, { kind: ["spec_review"] }).map((e) => e.id)).toEqual(["g1"]);
    expect(filterInbox(entries, { factory: ["shop"] }).map((e) => e.id)).toEqual(["g2"]);
    expect(filterInbox(entries, { q: "color" }).map((e) => e.id)).toEqual(["g2"]);
  });

  it("names the primary action", () => {
    expect(primaryAction(gateEntry(gate()))).toBe("Approve spec");
    expect(primaryAction(gateEntry(gate({ kind: "preview" })))).toBe("Accept preview");
    expect(primaryAction(gateEntry(gate({ kind: "merge" })))).toBe("Approve");
    expect(primaryAction(gateEntry(gate({ kind: "question" })))).toBe("Answer");
  });
});

describe("spec retry", () => {
  it("is offered on open spec reviews and on a failed spec's question", () => {
    expect(canRetrySpec(gate())).toBe(true);
    expect(canRetrySpec(gate({ kind: "question", name: "spec-failed" }))).toBe(true);
    expect(canRetrySpec(gate({ kind: "question", name: "clarify" }))).toBe(false);
    expect(canRetrySpec(gate({ kind: "preview" }))).toBe(false);
    expect(canRetrySpec(gate({ state: "approved" }))).toBe(false);
  });

  it("sends a model only when it differs from the agent's", () => {
    expect(retryModel("claude-haiku-5-5", "claude-sonnet-5-5")).toBe("claude-haiku-5-5");
    expect(retryModel("claude-sonnet-5-5", "claude-sonnet-5-5")).toBeUndefined();
    expect(retryModel("", "claude-sonnet-5-5")).toBeUndefined();
  });
});
