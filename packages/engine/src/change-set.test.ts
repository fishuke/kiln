import { describe, expect, it } from "vitest";
import { changeSetSection, migrateWorkItem, setRepos, upsertPr, withChangeSetSection } from "./change-set";
import type { WorkItem } from "./types";

const base = { id: "wi_1", loops: {}, conversation: [], attachments: [] } as unknown as WorkItem;

describe("migrateWorkItem", () => {
  it("turns an old single-repository row into a change set of one", () => {
    const old = { ...base, repo: "acme/api", pr: { repo: "acme/api", number: 4, url: "https://x/4" }, previewUrl: "https://p.test" } as WorkItem;
    const wi = migrateWorkItem(old);
    expect(wi.repos).toEqual([{ repo: "acme/api", role: "changed" }]);
    expect(wi.prs).toEqual([{ repo: "acme/api", number: 4, url: "https://x/4" }]);
    expect(wi.previews).toEqual([{ service: "app", url: "https://p.test", status: "ready" }]);
  });

  it("leaves a row without a repository, pull request or preview alone", () => {
    const wi = migrateWorkItem({ ...base });
    expect(wi.repos).toBeUndefined();
    expect(wi.prs).toBeUndefined();
    expect(wi.previews).toBeUndefined();
  });

  it("is idempotent and keeps sets already written", () => {
    const wi = { ...base, repos: [{ repo: "a/x", role: "changed" }, { repo: "a/y", role: "changed" }], repo: "a/x" } as WorkItem;
    expect(migrateWorkItem(migrateWorkItem(wi)).repos).toHaveLength(2);
  });
});

describe("upsertPr", () => {
  it("adds pull requests in order and mirrors the first into pr", () => {
    const wi = { ...base } as WorkItem;
    upsertPr(wi, { repo: "a/api", number: 1, url: "u1" });
    upsertPr(wi, { repo: "a/web", number: 2, url: "u2" });
    upsertPr(wi, { repo: "a/api", number: 1, url: "u1", mergedAt: "t" });
    expect(wi.prs!.map((p) => p.repo)).toEqual(["a/api", "a/web"]);
    expect(wi.prs![0]!.mergedAt).toBe("t");
    expect(wi.pr).toEqual(wi.prs![0]);
  });
});

describe("setRepos", () => {
  it("keeps changed repositories first and mirrors the first into repo", () => {
    const wi = { ...base } as WorkItem;
    setRepos(wi, [
      { repo: "a/docs", role: "context" },
      { repo: "a/web", role: "changed" },
      { repo: "a/api", role: "changed" },
      { repo: "a/web", role: "context" },
    ]);
    expect(wi.repos).toEqual([
      { repo: "a/web", role: "changed" },
      { repo: "a/api", role: "changed" },
      { repo: "a/docs", role: "context" },
    ]);
    expect(wi.repo).toBe("a/web");
  });
});

describe("change set section", () => {
  const prs = [
    { repo: "a/api", number: 1, url: "https://g/a/api/pull/1" },
    { repo: "a/web", number: 7, url: "https://g/a/web/pull/7" },
  ];

  it("lists every pull request and marks this one", () => {
    const s = changeSetSection(prs, "a/web");
    expect(s).toContain("## Change set");
    expect(s).toContain("[a/api#1](https://g/a/api/pull/1)");
    expect(s).toContain("a/web#7 (this pull request)");
  });

  it("is empty for a change set of one", () => {
    expect(changeSetSection(prs.slice(0, 1), "a/api")).toBe("");
  });

  it("replaces an earlier section instead of adding another", () => {
    const once = withChangeSetSection("Body\n", prs.slice(0, 1).concat(prs[1]!), "a/api");
    const twice = withChangeSetSection(once, [...prs, { repo: "a/admin", number: 3, url: "https://g/a/admin/pull/3" }], "a/api");
    expect(twice.match(/## Change set/g)).toHaveLength(1);
    expect(twice).toContain("a/admin#3");
    expect(twice.startsWith("Body")).toBe(true);
  });
});
