import { describe, expect, it } from "vitest";
import { buildInbox, filterInbox, gateEntry, primaryAction, questionOptions, questionPrompt, type GateLike } from "./inbox-model";

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
    expect(entries.map((e) => e.kind).sort()).toEqual(["answered_question", "failed", "pr_review", "spec_review"]);
    expect(entries.find((e) => e.gateId === "g2")!.previewUrl).toBe("https://p");
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
    expect(primaryAction(gateEntry(gate({ kind: "question" })))).toBe("Answer");
  });
});
