import { describe, expect, it } from "vitest";
import {
  cowboyConfirmation,
  defaultShipMode,
  fileTree,
  groupByDay,
  needsYouCount,
  nextMode,
  previewSrc,
  routesFrom,
  shipModeCopy,
  splitDiff,
  turnCard,
  unappliedTurns,
  versionForTurn,
  versionNumber,
  workTitle,
  importSteps,
  chatRunStatus,
  prSteps,
  mergedLabel,
  reviewFor,
} from "./model";
import type { Chat, Preview, StudioApp, Turn, Version } from "./types";

describe("importSteps", () => {
  const app = (o: Partial<StudioApp>): StudioApp => ({
    id: "sp_1",
    team: "t",
    name: "Shop",
    source: { kind: "repo", repo: "acme/shop" },
    shipMode: "review",
    harness: "claude-code",
    status: "creating",
    createdBy: "me",
    createdAt: "",
    updatedAt: "",
    ...o,
  });
  const setup = { mainBranch: "main", packageManager: "pnpm" as const, install: ["pnpm install"], envRequired: [], envMissing: [] };
  const statuses = (a: StudioApp, p?: Preview) => importSteps(a, p).map((s) => s.status);
  it("walks clone → install → dev server → preview", () => {
    expect(statuses(app({}))).toEqual(["running", "pending", "pending", "pending"]);
    expect(statuses(app({ setup }))).toEqual(["done", "running", "pending", "pending"]);
    expect(statuses(app({ setup, status: "ready" }), { target: "sv", url: "u", status: "starting" })).toEqual(["done", "done", "running", "pending"]);
    expect(statuses(app({ setup, status: "ready" }), { target: "sv", url: "u", status: "ready" })).toEqual(["done", "done", "done", "done"]);
  });
  it("marks the running step failed", () => {
    expect(statuses(app({ setup, status: "failed" }))).toEqual(["done", "failed", "pending", "pending"]);
  });
  it("names the detected package manager", () => {
    expect(importSteps(app({ setup }), undefined)[1]!.label).toBe("Install with pnpm");
  });
});

const turn = (o: Partial<Turn>): Turn => ({
  id: "st_1",
  appId: "sp",
  chatId: "sc_a",
  prompt: "p",
  mode: "build",
  via: "web",
  by: "me",
  status: "succeeded",
  reply: "",
  discarded: false,
  activity: [],
  costUsd: 0,
  startedAt: "2026-10-22T10:00:00.000Z",
  finishedAt: "2026-10-22T10:00:34.000Z",
  ...o,
});
const version = (o: Partial<Version>): Version => ({
  id: "sv",
  appId: "sp",
  sha: "x",
  title: "t",
  kind: "apply",
  chatId: "sc_a",
  bookmarked: false,
  createdAt: "2026-10-22T10:00:35.000Z",
  ...o,
});
const chat = (o: Partial<Chat>): Chat => ({
  id: "sc_a",
  appId: "sp",
  title: "c",
  mode: "build",
  harness: "claude-code",
  branch: "chat/sc_a",
  path: "chats/sc_a",
  port: 4101,
  status: "idle",
  createdAt: "",
  updatedAt: "",
  ...o,
});

describe("turnCard", () => {
  it("shows a version card only for a checkpoint that was kept", () => {
    expect(turnCard(turn({ checkpoint: "abc" }))).toBe("version");
    expect(turnCard(turn({ checkpoint: "abc", discarded: true }))).toBe("discarded");
  });
  it("makes no card for a question or a plain answer", () => {
    expect(turnCard(turn({ question: "Which one?" }))).toBe("question");
    expect(turnCard(turn({}))).toBe("none");
    expect(turnCard(turn({ status: "running", checkpoint: "abc" }))).toBe("none");
  });
  it("shows the plan card for a plan", () => {
    expect(turnCard(turn({ plan: "1. Do it" }))).toBe("plan");
  });
});

describe("versionForTurn", () => {
  it("finds the version made after the turn and before the chat's next checkpoint", () => {
    const a = turn({ id: "a", checkpoint: "1", finishedAt: "2026-10-22T10:00:00.000Z" });
    const b = turn({ id: "b", checkpoint: "2", finishedAt: "2026-10-22T11:00:00.000Z" });
    const v1 = version({ id: "v1", createdAt: "2026-10-22T10:00:01.000Z" });
    const v2 = version({ id: "v2", createdAt: "2026-10-22T11:00:01.000Z" });
    const other = version({ id: "vx", chatId: "sc_b", createdAt: "2026-10-22T10:00:00.500Z" });
    expect(versionForTurn(a, [a, b], [v2, other, v1])?.id).toBe("v1");
    expect(versionForTurn(b, [a, b], [v2, other, v1])?.id).toBe("v2");
  });
  it("is undefined before the chat is applied", () => {
    const a = turn({ id: "a", checkpoint: "1" });
    expect(versionForTurn(a, [a], [])).toBeUndefined();
  });
});

describe("unappliedTurns", () => {
  it("lists checkpoints after appliedSha", () => {
    const ts = [turn({ id: "a", checkpoint: "1" }), turn({ id: "q" }), turn({ id: "b", checkpoint: "2" }), turn({ id: "c", checkpoint: "3" })];
    expect(unappliedTurns(chat({ appliedSha: "1" }), ts).map((t) => t.id)).toEqual(["b", "c"]);
    expect(unappliedTurns(chat({}), ts).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(unappliedTurns(chat({ appliedSha: "3" }), ts)).toEqual([]);
  });
});

describe("modes and ship modes", () => {
  it("cycles Build → Chat → Plan → Build", () => {
    expect([nextMode("build"), nextMode("chat"), nextMode("plan")]).toEqual(["chat", "plan", "build"]);
  });
  it("defaults an imported repository to Review and a template to Cowboy", () => {
    expect(defaultShipMode({ kind: "repo", repo: "acme/shop", branch: "main" })).toBe("review");
    expect(defaultShipMode({ kind: "template", template: "nextjs" })).toBe("cowboy");
  });
  it("keeps one plain line per ship mode", () => {
    expect(shipModeCopy("safe").line).toBe("Nothing leaves the sandbox until you ship");
    expect(shipModeCopy("review").line).toBe("Opens a pull request for review");
    expect(shipModeCopy("cowboy").line).toBe("Pushes straight to main");
  });
  it("asks before Cowboy on an imported repository", () => {
    expect(cowboyConfirmation({ kind: "repo", repo: "acme/shop" })).toBe("Changes will push straight to main of acme/shop.");
    expect(cowboyConfirmation({ kind: "template", template: "nextjs" })).toBeUndefined();
  });
});

describe("versions", () => {
  it("numbers from the oldest and groups by day", () => {
    const vs = [
      version({ id: "b", createdAt: "2026-10-22T09:00:00.000Z" }),
      version({ id: "a", createdAt: "2026-10-21T09:00:00.000Z" }),
      version({ id: "c", createdAt: "2026-10-18T09:00:00.000Z" }),
    ];
    expect(versionNumber(vs, "b")).toBe(3);
    const groups = groupByDay(vs, new Date("2026-10-22T12:00:00.000Z"));
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Oct 18"]);
  });
  it("counts what needs you across apps", () => {
    expect(
      needsYouCount({
        apps: [
          { id: "p", name: "p", working: [], needsYou: [{ chatId: "c", question: "?" }] },
          { id: "q", name: "q", working: [], needsYou: [] },
        ],
      }),
    ).toBe(1);
    expect(needsYouCount(undefined)).toBe(0);
  });
  it("says how long a turn worked", () => {
    expect(workTitle(turn({}))).toBe("Worked for 34s");
    expect(workTitle(turn({ status: "running" }))).toBe("Working");
  });
});

describe("preview", () => {
  it("puts the route in the path and keeps the query", () => {
    expect(previewSrc("https://sc_a.preview.example.com", "/pricing")).toBe("https://sc_a.preview.example.com/pricing");
    expect(previewSrc("/api/studio/fake-preview/sc_a?title=x", "about")).toBe("/api/studio/fake-preview/sc_a/about?title=x");
    expect(previewSrc("http://127.0.0.1:4101/", "/")).toBe("http://127.0.0.1:4101/");
  });
  it("finds Next.js routes in changed paths", () => {
    expect(routesFrom(["app/page.tsx", "app/pricing/page.tsx", "src/app/(marketing)/about/page.tsx", "components/x.tsx"])).toEqual(["/", "/about", "/pricing"]);
  });
});

describe("diffs", () => {
  const diff = [
    "diff --git a/app/page.tsx b/app/page.tsx",
    "--- a/app/page.tsx",
    "+++ b/app/page.tsx",
    "@@ -1,2 +1,2 @@",
    "-old",
    "+new",
    " same",
    "diff --git a/components/x.tsx b/components/x.tsx",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/components/x.tsx",
    "@@ -0,0 +1 @@",
    "+x",
  ].join("\n");
  it("splits per file with counts", () => {
    const files = splitDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["app/page.tsx", "modified", 1, 1],
      ["components/x.tsx", "added", 1, 0],
    ]);
  });
  it("builds a file tree with folders first", () => {
    expect(fileTree(["b.ts", "app/page.tsx", "app/ui/x.tsx"])).toEqual([
      {
        type: "folder",
        name: "app",
        path: "app",
        children: [
          { type: "folder", name: "ui", path: "app/ui", children: [{ type: "file", name: "x.tsx", path: "app/ui/x.tsx" }] },
          { type: "file", name: "page.tsx", path: "app/page.tsx" },
        ],
      },
      { type: "file", name: "b.ts", path: "b.ts" },
    ]);
  });
});

describe("chat run status", () => {
  it("maps a chat to a run status", () => {
    expect([chat({ status: "working" }), chat({ status: "conflict" }), chat({ status: "idle" })].map((c) => chatRunStatus(c))).toEqual(["running", "blocked", "complete"]);
    expect(chatRunStatus(chat({ status: "idle" }), turn({ status: "cancelled" }))).toBe("cancelled");
  });
});

describe("pull request steps", () => {
  const steps = (s: Parameters<typeof prSteps>[0]) => prSteps(s).map((x) => `${x.label}:${x.status}`);
  it("shows every step for the author", () => {
    expect(steps("uat")).toEqual(["UAT:current", "Ready for review:todo", "Merged:todo"]);
    expect(steps("ready_for_review")).toEqual(["UAT:done", "Ready for review:current", "Merged:todo"]);
    expect(steps("merged")).toEqual(["UAT:done", "Ready for review:done", "Merged:done"]);
    expect(steps("waiting_for_review")).toEqual(["UAT:done", "Ready for review:done", "Waiting for review:waiting"]);
    expect(steps("cancelled")).toEqual(["UAT:done", "Cancelled:cancelled"]);
  });
});

describe("merge gate", () => {
  const review = { state: "merged" as const, decision: { action: "merge" }, mergedBy: "kiln-merge-gate" };
  it("says who merged", () => {
    expect(mergedLabel(review)).toBe("Merged by the merge gate");
    expect(mergedLabel({ ...review, decision: { action: "review" }, mergedBy: "ana" })).toBe("Merged by ana");
    expect(mergedLabel(undefined)).toBe("Merged");
    expect(prSteps("merged", "Merged by the merge gate").at(-1)).toEqual({ label: "Merged by the merge gate", status: "done" });
  });
  it("finds the review of a pull request", () => {
    const r = (o: object) => ({ id: "mrv", repo: "acme/a", number: 1, ...o }) as never;
    expect(reviewFor([r({ id: "x", pullRequestId: "pr_1" })], { id: "pr_1", repo: "acme/b", number: 9 })).toMatchObject({ id: "x" });
    expect(reviewFor([r({ id: "y" })], { id: "pr_2", repo: "acme/a", number: 1 })).toMatchObject({ id: "y" });
  });
});
