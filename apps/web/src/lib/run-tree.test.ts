import { describe, expect, it } from "vitest";
import { buildRunRows, canCancel, runSource, runTitle, filterRows, longDuration, mediaChipLabel, parseRunFilters, presetRange, relativeTime, runFiltersToQuery, shortDuration, sourceLabel, stepCount, workItemStatus, type RunLike, type WorkItemLike } from "./run-tree";

const wi = (id: string, over: Partial<WorkItemLike> = {}): WorkItemLike => ({
  id,
  factory: "kiln",
  title: `Item ${id}`,
  state: "complete",
  source: { provider: "kiln" },
  requester: "me@kiln.local",
  costUsd: 1,
  createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:30:00Z",
  ...over,
});
const run = (id: string, over: Partial<RunLike> = {}): RunLike => ({ id, kind: "work", factory: "kiln", agent: "implement", status: "succeeded", costUsd: 0.5, startedAt: "2026-10-20T10:05:00Z", artifacts: [], ...over });

describe("buildRunRows", () => {
  it("nests a work item's runs and their subagents", () => {
    const rows = buildRunRows(
      [wi("wi_1", { pr: { repo: "o/r", number: 1, url: "https://x/pr/1" } })],
      [
        run("r1", { workItemId: "wi_1", stage: "triage", agent: "triage" }),
        run("r2", { workItemId: "wi_1", artifacts: [{ kind: "image", name: "a.png", url: "u" }, { kind: "video", name: "v.webm", url: "u" }] }),
        run("r3", { workItemId: "wi_1", parentRunId: "r2", agent: "review", artifacts: [{ kind: "image", name: "b.png", url: "u" }] }),
      ],
    );
    expect(rows).toHaveLength(1);
    const [root] = rows;
    expect(root!.href).toBe("/runs/wi_1");
    expect(root!.prUrl).toBe("https://x/pr/1");
    expect(root!.children.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(root!.children[1]!.children.map((c) => c.id)).toEqual(["r3"]);
    expect(root!.images).toBe(2);
    expect(root!.videos).toBe(1);
    expect(root!.children[0]!.title).toBe("Triage");
    expect(root!.children[0]!.source).toBe("orchestration");
  });

  it("folds repeated attempts of a step into one row showing the latest", () => {
    const at = (m: number) => `2026-10-20T10:${String(m).padStart(2, "0")}:00Z`;
    const rows = buildRunRows(
      [wi("wi_1", { state: "blocked", blockedReason: "implement failed twice" })],
      [
        run("t1", { workItemId: "wi_1", agent: "triage", stage: "triage", startedAt: at(1) }),
        run("b1", { workItemId: "wi_1", stage: "build", status: "failed", startedAt: at(2) }),
        run("b2", { workItemId: "wi_1", stage: "build", status: "failed", startedAt: at(3) }),
        run("s1", { workItemId: "wi_1", parentRunId: "b2", agent: "review", startedAt: at(4) }),
        run("b3", { workItemId: "wi_1", stage: "build", status: "running", startedAt: at(5) }),
      ],
    );
    const [root] = rows;
    expect(root!.statusNote).toBe("implement failed twice");
    expect(root!.progress).toBeUndefined();
    expect(root!.children.map((c) => c.id)).toEqual(["t1", "b3"]);
    const latest = root!.children[1]!;
    expect(latest.status).toBe("running");
    expect(latest.attempts).toBe(3);
    expect(latest.children.map((c) => [c.id, c.attempt])).toEqual([["b2", 2], ["b1", 1]]);
    expect(latest.children[0]!.children.map((c) => c.id)).toEqual(["s1"]);
    expect(stepCount(root!.children)).toBe(2);
  });

  it("shows the current stage and plan progress on a task", () => {
    const plan = { cursor: 1, stages: [{ id: "triage", kind: "triage" }, { id: "build", kind: "build" }, { id: "handoff", kind: "handoff" }] };
    expect(buildRunRows([wi("wi_p", { state: "building", plan })], [])[0]!.progress).toBe("Implement · 1/3");
  });

  it("leaves an agent foreman's turns out of the children and shows its checklist progress", () => {
    const tasks = [{ title: "Triage", status: "done" as const }, { title: "Implement", status: "active" as const }];
    const [row] = buildRunRows([wi("wi_f", { state: "building", tasks })], [run("f1", { workItemId: "wi_f", agent: "foreman", stage: "foreman" }), run("i1", { workItemId: "wi_f", stage: "build" })]);
    expect(row!.children.map((c) => c.id)).toEqual(["i1"]);
    expect(row!.progress).toBe("Implement · 1/2");
  });

  it("keeps runs without a work item as roots", () => {
    const rows = buildRunRows([], [run("b1", { kind: "benchmark" })]);
    expect(rows[0]!.source).toBe("benchmark");
    expect(rows[0]!.children).toEqual([]);
  });
});

describe("filterRows", () => {
  const rows = buildRunRows(
    [wi("wi_a", { title: "Alpha", state: "building", requester: "me@kiln.local" }), wi("wi_b", { title: "Beta", state: "failed", requester: "other@kiln.local", updatedAt: "2026-10-20T11:00:00Z" })],
    [run("r1", { workItemId: "wi_a", agent: "review", status: "failed" })],
  );

  it("filters to my runs", () => {
    expect(filterRows(rows, { mine: true, me: "me@kiln.local" }).map((r) => r.id)).toEqual(["wi_a"]);
  });

  it("keeps a parent when only a child matches the status", () => {
    const out = filterRows(rows, { status: ["failed"] });
    expect(out.map((r) => r.id).sort()).toEqual(["wi_a", "wi_b"]);
    expect(out.find((r) => r.id === "wi_a")!.children.map((c) => c.id)).toEqual(["r1"]);
  });

  it("hides a cancelled task even when one of its runs matches the status", () => {
    const dead = buildRunRows([wi("wi_x", { state: "cancelled" })], [run("y1", { workItemId: "wi_x", stage: "build", status: "failed" })]);
    expect(filterRows(dead, { status: ["running", "failed", "blocked"] })).toEqual([]);
    expect(filterRows(dead, { status: ["cancelled"] }).map((r) => r.id)).toEqual(["wi_x"]);
  });

  it("ignores superseded attempts when filtering by status", () => {
    const tried = buildRunRows(
      [wi("wi_c", { state: "complete" })],
      [run("x1", { workItemId: "wi_c", stage: "build", status: "failed", startedAt: "2026-10-20T10:01:00Z" }), run("x2", { workItemId: "wi_c", stage: "build", status: "succeeded", startedAt: "2026-10-20T10:02:00Z" })],
    );
    expect(filterRows(tried, { status: ["failed"] })).toEqual([]);
  });

  it("searches titles and sorts", () => {
    expect(filterRows(rows, { q: "bet" }).map((r) => r.id)).toEqual(["wi_b"]);
    expect(filterRows(rows, { sort: "title", dir: "asc" }).map((r) => r.title)).toEqual(["Alpha", "Beta"]);
    expect(filterRows(rows, {}).map((r) => r.id)).toEqual(["wi_b", "wi_a"]);
  });

  it("filters by created range", () => {
    expect(filterRows(rows, { from: "2026-10-21" })).toEqual([]);
    expect(filterRows(rows, { from: "2026-10-20", to: "2026-10-20" })).toHaveLength(2);
  });
});

describe("URL state", () => {
  it("defaults to My runs only without parameters", () => {
    expect(parseRunFilters(new URLSearchParams("")).mine).toBe(true);
    expect(parseRunFilters(new URLSearchParams("all=1")).mine).toBe(false);
  });

  it("hides completed and cancelled runs by default", () => {
    expect(parseRunFilters(new URLSearchParams("")).status).toEqual(["running", "failed", "blocked"]);
    expect(parseRunFilters(new URLSearchParams("all=1")).status).toBeUndefined();
    expect(parseRunFilters(new URLSearchParams("status=complete")).status).toEqual(["complete"]);
  });

  it("round-trips", () => {
    const f = parseRunFilters(new URLSearchParams("mine=1&status=failed,running&createdOn=2026-10-01.2026-10-20&sort=title&dir=asc"));
    expect(f).toMatchObject({ mine: true, status: ["failed", "running"], from: "2026-10-01", to: "2026-10-20", sort: "title", dir: "asc" });
    expect(runFiltersToQuery(f)).toBe("?mine=1&status=failed%2Crunning&createdOn=2026-10-01.2026-10-20&sort=title&dir=asc");
    expect(runFiltersToQuery({})).toBe("?all=1");
  });
});

describe("labels", () => {
  it("media chip", () => {
    expect(mediaChipLabel(1, 1)).toBe("1 Image, 1 Video");
    expect(mediaChipLabel(2, 0)).toBe("2 Images");
    expect(mediaChipLabel(0, 0)).toBeUndefined();
  });
  it("sources and states", () => {
    expect(sourceLabel("kiln")).toBe("Kiln Web");
    expect(sourceLabel("orchestration")).toBe("Orchestration");
    expect(sourceLabel("WEB_APP")).toBe("Kiln Web");
    expect(sourceLabel("GITHUB_ACTION")).toBe("GitHub Action");
    expect(workItemStatus("awaiting_spec")).toBe("blocked");
    expect(workItemStatus("building")).toBe("running");
    expect(workItemStatus("handed_off")).toBe("complete");
  });
  it("times", () => {
    const now = new Date("2026-10-20T12:00:00Z").getTime();
    expect(relativeTime("2026-10-20T11:31:00Z", now)).toBe("29 minutes ago");
    expect(relativeTime("2026-10-20T11:00:00Z", now)).toBe("about 1 hour ago");
    expect(shortDuration(2071_000)).toBe("34m 31s");
    expect(longDuration(2071_000)).toBe("34 minutes 31 seconds");
  });
  it("date presets", () => {
    const now = new Date(2026, 9, 20); // Tuesday
    expect(presetRange("Today", now)).toEqual({ from: "2026-10-20", to: "2026-10-20" });
    expect(presetRange("This week", now)).toEqual({ from: "2026-10-18", to: "2026-10-24" });
    expect(presetRange("Last month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("All time", now)).toEqual({});
  });
});

describe("child runs", () => {
  const run: RunLike = { id: "run_1", kind: "work", factory: "shop", workItemId: "wi_1", agent: "verify", stage: "verify", title: "Saved carts", source: "WEB_APP", status: "succeeded", costUsd: 0, startedAt: "2026-10-20T10:00:00Z" };
  it("titles a work-item run by its stage when the API echoes the work item title", () => {
    expect(runTitle(run, "Saved carts")).toBe("Verify Saved carts");
    expect(runTitle({ ...run, title: "Check the cart badge" }, "Saved carts")).toBe("Check the cart badge");
  });
  it("marks runs launched by the foreman as orchestration", () => {
    expect(runSource(run)).toBe("orchestration");
    expect(runSource({ ...run, workItemId: undefined })).toBe("WEB_APP");
  });
});

describe("canCancel", () => {
  it("allows cancelling live runs only", () => {
    expect(canCancel({ status: "running" })).toBe(true);
    expect(canCancel({ status: "blocked" })).toBe(true);
    expect(canCancel({ status: "complete" })).toBe(false);
    expect(canCancel({ status: "failed" })).toBe(false);
    expect(canCancel({ status: "cancelled" })).toBe(false);
  });
});
