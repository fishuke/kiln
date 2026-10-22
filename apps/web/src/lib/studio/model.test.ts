import { describe, expect, it } from "vitest";
import {
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
} from "./model";
import type { Chat, Turn, Version } from "./types";

const turn = (o: Partial<Turn>): Turn => ({
  id: "st_1",
  projectId: "sp",
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
  projectId: "sp",
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
  projectId: "sp",
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
    expect(shipModeCopy("review", { kind: "repo", repo: "acme/shop", branch: "main" }).line).toMatch(/never pushes to main/);
  });
  it("says Cowboy pushes a studio branch for an imported repository", () => {
    expect(shipModeCopy("cowboy").line).toMatch(/pushes main/);
    expect(shipModeCopy("cowboy", { kind: "repo", repo: "acme/shop", branch: "main" }, "sp_1").line).toMatch(/studio\/sp_1 branch/);
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
  it("counts what needs you across projects", () => {
    expect(
      needsYouCount({
        projects: [
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
