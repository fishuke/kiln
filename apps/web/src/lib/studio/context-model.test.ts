import { describe, expect, it } from "vitest";
import { questionProps, type DocBlock } from "./context-doc";
import {
  activityLine,
  answerText,
  batchProgress,
  canDecide,
  canEdit,
  catchUp,
  clampSplit,
  parseContextLayout,
  chatMessages,
  decide,
  delegatedAnswer,
  fragmentsFrom,
  freshness,
  needsYou,
  questionDisplay,
  questionsFrom,
  sinceLastVisit,
  statusFor,
  validateAnswer,
  writeOutcome,
} from "./context-model";
import type { AgentStatus, ContextChange, ContextState, Member, Proposal, Question, QuestionSpec } from "./types";

const options = [
  { id: "me", label: "Just me", consequence: "No accounts" },
  { id: "team", label: "A small team", recommended: true },
  { id: "web", label: "Anyone on the web" },
];
const single: QuestionSpec = { kind: "single", title: "Who is it for?", options };
const multi: QuestionSpec = { kind: "multi", title: "What is in?", options, max: 2 };
const bool: QuestionSpec = { kind: "boolean", title: "Offline?", yes: "Works offline", no: "Online only" };
const scale: QuestionSpec = { kind: "scale", title: "How polished?", min: 1, max: 5, step: 1, minLabel: "Rough", maxLabel: "Demo-ready", default: 4 };
const rank: QuestionSpec = { kind: "rank", title: "What matters most?", options };
const text: QuestionSpec = { kind: "text", title: "What is it called?", suggestion: "Recipe box" };
const sketch: QuestionSpec = {
  kind: "sketch",
  title: "Which layout?",
  options: [
    { id: "list", label: "List", layout: "list" },
    { id: "grid", label: "Grid", layout: "grid", recommended: true },
  ],
};

describe("validateAnswer", () => {
  it("accepts a value that fits the spec", () => {
    expect(validateAnswer(single, { type: "value", value: "team" }).ok).toBe(true);
    expect(validateAnswer(multi, { type: "value", value: ["me", "web"] }).ok).toBe(true);
    expect(validateAnswer(bool, { type: "value", value: false }).ok).toBe(true);
    expect(validateAnswer(scale, { type: "value", value: 3 }).ok).toBe(true);
    expect(validateAnswer(rank, { type: "value", value: ["web", "me", "team"] }).ok).toBe(true);
    expect(validateAnswer(text, { type: "value", value: "  Pantry " })).toEqual({ ok: true, answer: { type: "value", value: "Pantry" } });
    expect(validateAnswer(sketch, { type: "value", value: "grid" }).ok).toBe(true);
  });

  it("rejects a value that does not fit, and says why", () => {
    expect(validateAnswer(single, { type: "value", value: "nobody" })).toEqual({ ok: false, error: "Pick one of the options" });
    expect(validateAnswer(single, { type: "value", value: ["me"] }).ok).toBe(false);
    expect(validateAnswer(multi, { type: "value", value: [] })).toEqual({ ok: false, error: "Pick at least one" });
    expect(validateAnswer(multi, { type: "value", value: ["me", "team", "web"] })).toEqual({ ok: false, error: "Pick at most 2" });
    expect(validateAnswer(multi, { type: "value", value: ["me", "me"] }).ok).toBe(false);
    expect(validateAnswer(bool, { type: "value", value: "yes" }).ok).toBe(false);
    expect(validateAnswer(scale, { type: "value", value: 9 })).toEqual({ ok: false, error: "Pick a value from 1 to 5" });
    expect(validateAnswer(scale, { type: "value", value: 2.5 }).ok).toBe(false);
    expect(validateAnswer(rank, { type: "value", value: ["web", "me"] })).toEqual({ ok: false, error: "Rank every option once" });
    expect(validateAnswer(text, { type: "value", value: "   " })).toEqual({ ok: false, error: "Write an answer" });
  });

  it("takes Something else, You decide and Skip on every kind", () => {
    for (const spec of [single, multi, bool, scale, rank, text, sketch]) {
      expect(validateAnswer(spec, { type: "other", text: " Only my family " })).toEqual({ ok: true, answer: { type: "other", text: "Only my family" } });
      expect(validateAnswer(spec, { type: "other", text: " " }).ok).toBe(false);
      expect(validateAnswer(spec, { type: "delegated" }).ok).toBe(true);
      expect(validateAnswer(spec, { type: "skipped" }).ok).toBe(true);
    }
  });
});

describe("answers as text and status", () => {
  it("writes the answer the way the decision shows it", () => {
    expect(answerText(single, { type: "value", value: "team" })).toBe("A small team");
    expect(answerText(multi, { type: "value", value: ["me", "web"] })).toBe("Just me, Anyone on the web");
    expect(answerText(bool, { type: "value", value: true })).toBe("Works offline");
    expect(answerText({ kind: "boolean", title: "Offline?" }, { type: "value", value: false })).toBe("No");
    expect(answerText(scale, { type: "value", value: 5 })).toBe("5 of 5 (Demo-ready)");
    expect(answerText(scale, { type: "value", value: 3 })).toBe("3 of 5");
    expect(answerText(rank, { type: "value", value: ["web", "me", "team"] })).toBe("1. Anyone on the web  2. Just me  3. A small team");
    expect(answerText(text, { type: "other", text: "Pantry" })).toBe("Pantry");
    expect(answerText(single, { type: "skipped" })).toBe("Skipped");
  });

  it("maps an answer to the question's status", () => {
    expect(statusFor({ type: "value", value: "me" })).toBe("answered");
    expect(statusFor({ type: "other", text: "x" })).toBe("answered");
    expect(statusFor({ type: "delegated" })).toBe("delegated");
    expect(statusFor({ type: "skipped" })).toBe("skipped");
  });

  it("You decide picks the recommended option, the default or a sensible middle", () => {
    expect(delegatedAnswer(single)).toEqual({ type: "value", value: "team" });
    expect(delegatedAnswer(sketch)).toEqual({ type: "value", value: "grid" });
    expect(delegatedAnswer({ ...single, options: options.map((o) => ({ ...o, recommended: false })) })).toEqual({ type: "value", value: "me" });
    expect(delegatedAnswer(multi)).toEqual({ type: "value", value: ["team"] });
    expect(delegatedAnswer(bool)).toEqual({ type: "value", value: true });
    expect(delegatedAnswer(scale)).toEqual({ type: "value", value: 4 });
    expect(delegatedAnswer({ ...scale, default: undefined })).toEqual({ type: "value", value: 3 });
    expect(delegatedAnswer(rank)).toEqual({ type: "value", value: ["me", "team", "web"] });
    expect(delegatedAnswer(text)).toEqual({ type: "value", value: "Recipe box" });
    for (const spec of [single, multi, bool, scale, rank, text, sketch]) expect(validateAnswer(spec, delegatedAnswer(spec)).ok).toBe(true);
  });
});

const question = (id: string, index: number, total: number, status: Question["status"] = "open", batch = "b1"): Question => ({
  id,
  appId: "sa_1",
  chatId: "main",
  turnId: "ct_1",
  fragmentId: `block_${id}`,
  spec: single,
  status,
  batch: { id: batch, index, total },
});

describe("questions on screen", () => {
  it("shows a batch of up to three all at once", () => {
    const qs = [question("a", 0, 3, "answered"), question("b", 1, 3), question("c", 2, 3)];
    expect(qs.map((q) => questionDisplay(q, qs))).toEqual(["settled", "expanded", "expanded"]);
  });

  it("steps through a larger batch one open question at a time", () => {
    const qs = [question("a", 0, 5, "answered"), question("b", 1, 5), question("c", 2, 5), question("d", 3, 5, "skipped"), question("e", 4, 5)];
    expect(qs.map((q) => questionDisplay(q, qs))).toEqual(["settled", "expanded", "collapsed", "settled", "collapsed"]);
  });

  it("counts a batch's progress", () => {
    const qs = [question("a", 0, 3, "answered"), question("b", 1, 3, "delegated"), question("c", 2, 3), question("x", 0, 1, "open", "b2")];
    expect(batchProgress(qs, "b1")).toEqual({ done: 2, total: 3, complete: false });
    expect(batchProgress([question("a", 0, 1, "skipped")], "b1")).toEqual({ done: 1, total: 1, complete: true });
    expect(batchProgress(qs, "nope")).toEqual({ done: 0, total: 0, complete: false });
  });
});

const state = (o: Partial<ContextState> = {}): ContextState => ({ appId: "sa_1", version: 5, ...o });
const change = (version: number, fragmentId: string, by = "you@example.com", o: Partial<ContextChange> = {}): ContextChange => ({
  version,
  fragmentId,
  type: "requirement",
  title: `Fragment ${fragmentId}`,
  change: "edited",
  by,
  at: "2026-11-23T10:00:00.000Z",
  ...o,
});

describe("freshness", () => {
  it("has nothing to compare before the first build", () => {
    expect(freshness(state(), [])).toEqual({ kind: "never" });
  });

  it("is fresh when the build read the current version", () => {
    expect(freshness(state({ builtVersion: 5 }), [change(4, "a")])).toEqual({ kind: "fresh" });
    expect(freshness(state({ builtVersion: 7 }), [])).toEqual({ kind: "fresh" });
  });

  it("counts each changed fragment once and lists the newest change first", () => {
    const f = freshness(state({ builtVersion: 2 }), [change(2, "old"), change(3, "a"), change(4, "b"), change(5, "a", "ada@example.com", { title: "Sign-in" })]);
    expect(f).toEqual({
      kind: "behind",
      count: 2,
      fragments: [
        { id: "a", title: "Sign-in", type: "requirement", change: "edited" },
        { id: "b", title: "Fragment b", type: "requirement", change: "edited" },
      ],
    });
  });

  it("is still behind when the version moved without a recorded fragment", () => {
    expect(freshness(state({ builtVersion: 4 }), [])).toEqual({ kind: "behind", count: 1, fragments: [] });
  });
});

const member = (o: Partial<Member> = {}): Member => ({
  appId: "sa_1",
  user: "ada@example.com",
  name: "Ada",
  permission: "editor",
  role: "design",
  invitedBy: "you@example.com",
  ...o,
});
const now = new Date("2026-11-23T12:00:00.000Z");

describe("catch-up", () => {
  it("opens the Brief for a member who has never opened the App", () => {
    expect(catchUp({ member: member(), createdBy: "you@example.com", now })).toEqual({ open: true, reason: "new" });
  });

  it("opens it for anyone back after more than a day, the creator too", () => {
    expect(catchUp({ member: member({ lastSeenAt: "2026-11-22T11:00:00.000Z" }), createdBy: "you@example.com", now })).toEqual({ open: true, reason: "returning" });
    expect(catchUp({ member: member({ user: "you@example.com", lastSeenAt: "2026-11-20T11:00:00.000Z" }), createdBy: "you@example.com", now })).toEqual({
      open: true,
      reason: "returning",
    });
  });

  it("stays closed for the creator's first visit and for anyone who was just here", () => {
    expect(catchUp({ member: member({ user: "you@example.com", permission: "owner" }), createdBy: "you@example.com", now })).toEqual({ open: false, reason: "current" });
    expect(catchUp({ member: member({ lastSeenAt: "2026-11-23T09:00:00.000Z" }), createdBy: "you@example.com", now })).toEqual({ open: false, reason: "current" });
  });

  it("lists what changed since the last visit: other people's changes, newest per fragment", () => {
    const changes = [change(1, "a"), change(3, "a", "you@example.com", { title: "Newer a" }), change(4, "b", "ada@example.com"), change(5, "c", "agent")];
    expect(sinceLastVisit(changes, member({ lastSeenVersion: 2 })).map((c) => [c.fragmentId, c.title])).toEqual([
      ["c", "Fragment c"],
      ["a", "Newer a"],
    ]);
    // A newcomer has seen nothing: everything is new to them.
    expect(sinceLastVisit(changes, member({ user: "sam@example.com" })).map((c) => c.fragmentId)).toEqual(["c", "b", "a"]);
  });

  it("collects what needs this member", () => {
    const proposals: Proposal[] = [
      { id: "p1", appId: "sa_1", by: "sam@example.com", kind: "add", summary: "Add export", patch: {}, status: "open", at: "" },
      { id: "p2", appId: "sa_1", by: "sam@example.com", kind: "add", summary: "Done", patch: {}, status: "accepted", at: "" },
    ];
    const questions = [question("a", 0, 2), question("b", 1, 2, "answered")];
    const fragments = fragmentsFrom("sa_1", [
      { id: "f1", type: "requirement", props: { reviewerRoles: "design,security" }, text: "Sign in with a magic link" },
      { id: "f2", type: "risk", props: { reviewerRoles: "legal" }, text: "Recipes may be copyrighted" },
    ]);
    const editor = needsYou({ member: member(), questions, proposals, fragments });
    expect(editor.questions.map((q) => q.id)).toEqual(["a"]);
    expect(editor.proposals.map((p) => p.id)).toEqual(["p1"]);
    expect(editor.reviews.map((f) => f.id)).toEqual(["f1"]);
    // A viewer can't decide proposals, so none wait for them.
    expect(needsYou({ member: member({ permission: "viewer", role: "legal" }), questions, proposals, fragments }).proposals).toEqual([]);
  });
});

describe("proposal rules", () => {
  const open: Proposal = { id: "p1", appId: "sa_1", by: "sam@example.com", kind: "edit", fragmentId: "f1", summary: "Tighten", patch: { text: "x" }, status: "open", at: "t0" };

  it("editors and the owner edit; a viewer's writes are proposals", () => {
    expect(canEdit("owner")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(writeOutcome("editor")).toBe("apply");
    expect(writeOutcome("viewer")).toBe("propose");
  });

  it("only an editor or the owner decides, and only an open proposal", () => {
    expect(canDecide(member(), open)).toBe(true);
    expect(canDecide(member({ permission: "owner" }), open)).toBe(true);
    expect(canDecide(member({ permission: "viewer" }), open)).toBe(false);
    expect(canDecide(member(), { ...open, status: "rejected" })).toBe(false);
  });

  it("records who decided, and the reason for a rejection", () => {
    expect(decide(open, member(), "accept")).toEqual({ ok: true, proposal: { ...open, status: "accepted", decidedBy: "ada@example.com" } });
    expect(decide(open, member(), "reject", "Out of scope")).toEqual({
      ok: true,
      proposal: { ...open, status: "rejected", decidedBy: "ada@example.com", reason: "Out of scope" },
    });
    expect(decide(open, member({ permission: "viewer" }), "accept")).toEqual({ ok: false, error: "Viewers can comment and propose; an editor decides" });
    expect(decide({ ...open, status: "accepted" }, member(), "reject")).toEqual({ ok: false, error: "This proposal is already accepted" });
  });
});

describe("fragments and questions from the document", () => {
  const q = question("sq_1", 0, 1, "answered");
  const blocks: DocBlock[] = [
    { id: "h", type: "heading", props: { level: 2 }, text: "Requirements" },
    { id: "p", type: "paragraph", props: {}, text: "Plain writing stays plain." },
    { id: "empty", type: "paragraph", props: {}, text: "" },
    { id: "r", type: "requirement", props: { ownerRole: "engineering", reviewerRoles: "security, qa", route: "/login", by: "agent" }, text: "Sign in with a magic link", parent: "h" },
    { id: "bq", type: "question", props: questionProps({ ...q, answer: { type: "value", value: "team" }, answeredBy: "ada@example.com", answeredAt: "t1" }), text: "" },
    { id: "bd", type: "question", props: questionProps({ ...q, id: "sq_2", status: "delegated", answer: { type: "value", value: "me" } }), text: "" },
    { id: "bo", type: "question", props: questionProps({ ...q, id: "sq_3", status: "open" }), text: "" },
    { id: "img", type: "image", props: { url: "x.png" }, text: "" },
  ];

  it("derives typed fragments, skipping empty text", () => {
    const fs = fragmentsFrom("sa_1", blocks, { r: 3 });
    expect(fs.map((f) => [f.id, f.type])).toEqual([
      ["h", "section"],
      ["p", "text"],
      ["r", "requirement"],
      ["bq", "decision"],
      ["bd", "assumption"],
      ["bo", "question"],
      ["img", "image"],
    ]);
    const r = fs.find((f) => f.id === "r")!;
    expect(r).toMatchObject({ ownerRole: "engineering", reviewerRoles: ["security", "qa"], version: 3, parent: "h", previewReference: { route: "/login" }, content: "Sign in with a magic link" });
    expect(r.provenance.at(-1)).toMatchObject({ by: "agent", kind: "agent" });
    // A decided question reads as its question and its answer.
    expect(fs.find((f) => f.id === "bq")!.content).toBe("Who is it for? A small team");
    expect(fs.find((f) => f.id === "p")!).toMatchObject({ ownerRole: "product", reviewerRoles: [], version: 1 });
  });

  it("reads the questions back out of their blocks", () => {
    const qs = questionsFrom("sa_1", blocks);
    expect(qs.map((x) => [x.id, x.status, x.fragmentId])).toEqual([
      ["sq_1", "answered", "bq"],
      ["sq_2", "delegated", "bd"],
      ["sq_3", "open", "bo"],
    ]);
    expect(qs[0]).toMatchObject({ answer: { type: "value", value: "team" }, answeredBy: "ada@example.com", spec: single });
  });
});

describe("activity line and split", () => {
  const agent = (o: Partial<AgentStatus>): AgentStatus => ({ state: "idle", label: "", ...o });

  it("is one row: a state and its object", () => {
    expect(activityLine(agent({ state: "writing", label: "Writing", object: "Requirements › Sign-in" }))).toEqual({ text: "Writing Requirements › Sign-in", busy: true });
    expect(activityLine(agent({ state: "building", label: "Building the prototype", done: 3, total: 7 }))).toEqual({
      text: "Building the prototype: 3 of 7 files",
      busy: true,
      progress: 3 / 7,
    });
    // The "Answer N questions" button says it; a second line would repeat it.
    expect(activityLine(agent({ state: "waiting", label: "Waiting" }))).toBeUndefined();
    expect(activityLine(agent({ state: "idle" }))).toBeUndefined();
  });

  it("keeps the split inside what both panes can use", () => {
    expect(clampSplit(46)).toBe(46);
    expect(clampSplit(5)).toBe(28);
    expect(clampSplit(95)).toBe(72);
    expect(clampSplit(Number.NaN)).toBe(46);
  });
});

describe("parseContextLayout", () => {
  it("reads a stored layout and falls back to the Context on the left", () => {
    expect(parseContextLayout("chat")).toBe("chat");
    expect(parseContextLayout("document")).toBe("document");
    expect(parseContextLayout(null)).toBe("document");
    expect(parseContextLayout("junk")).toBe("document");
  });
});

describe("chatMessages", () => {
  const t = (o: Partial<import("./types").ContextTurn>): import("./types").ContextTurn => ({
    id: "t1",
    appId: "a",
    by: "ada",
    kind: "prompt",
    prompt: "Make it blue",
    status: "succeeded",
    activity: [],
    costUsd: 0,
    startedAt: "2026-11-25T10:00:00Z",
    ...o,
  });
  it("turns each turn into the person's message and the agent's reply, oldest first", () => {
    const m = chatMessages([t({ id: "t1", reply: "Done." }), t({ id: "t2", prompt: "And bigger", status: "running" })]);
    expect(m.map((x) => [x.from, x.text])).toEqual([
      ["ada", "Make it blue"],
      ["agent", "Done."],
      ["ada", "And bigger"],
    ]);
    expect(m[2]?.live).toBe(true);
  });
  it("marks a failed reply and leaves out empty replies", () => {
    const m = chatMessages([t({ status: "failed", reply: "No sandbox" }), t({ id: "t2", reply: "" })]);
    expect(m.filter((x) => x.from === "agent")).toEqual([expect.objectContaining({ text: "No sandbox", failed: true })]);
  });
});
