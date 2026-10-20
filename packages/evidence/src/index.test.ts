import { LocalSandboxProvider } from "@kiln/sandbox";
import { MemoryObjectStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { collectPlaywrightEvidence, criteriaCovered, parseJUnit, previewCard } from "./index";

describe("test reports", () => {
  it("parses JUnit XML", () => {
    const report = parseJUnit(`<?xml version="1.0"?>
<testsuites><testsuite name="s">
  <testcase classname="auth" name="logs in" time="0.12"/>
  <testcase classname="auth" name="rejects bad password" time="0.2"><failure message="expected 401 &amp; got 200">stack</failure></testcase>
  <testcase classname="auth" name="sso"><skipped/></testcase>
</testsuite></testsuites>`);
    expect(report).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(report.cases[1]).toMatchObject({ message: "expected 401 & got 200", durationMs: 200 });
  });
});

describe("playwright evidence", () => {
  it("uploads a video per acceptance criterion to object storage", async () => {
    const sandbox = await new LocalSandboxProvider().create({
      runner: { image: "node:22", backend: "local", setupCommands: [], egress: [] },
      repos: [],
    });
    // A sample web app run: the reporter output and recorded videos, as Playwright writes them.
    for (const n of [1, 2]) await sandbox.writeFile(`app/test-results/ac${n}/video.webm`, `webm-bytes-${n}`);
    await sandbox.writeFile(
      "app/playwright-report/results.json",
      JSON.stringify({
        suites: [
          {
            title: "checkout.spec.ts",
            specs: [
              { title: "AC1: shows the cart total", tests: [{ results: [{ status: "passed", duration: 900, attachments: [{ name: "video", contentType: "video/webm", path: "test-results/ac1/video.webm" }] }] }] },
              { title: "AC2: applies a discount code", tests: [{ results: [{ status: "passed", duration: 1200, attachments: [{ name: "video", contentType: "video/webm", path: "test-results/ac2/video.webm" }] }] }] },
            ],
          },
        ],
      }),
    );
    const store = new MemoryObjectStore();
    const pkg = await collectPlaywrightEvidence({ sandbox, store, workItemId: "wi_1", cwd: "app", run: false });
    expect(await store.list("evidence/wi_1/videos/")).toEqual(["evidence/wi_1/videos/AC1-0.webm", "evidence/wi_1/videos/AC2-0.webm"]);
    expect(criteriaCovered(pkg, ["AC1", "AC2"])).toEqual({ ok: true, missing: [] });
    expect(criteriaCovered(pkg, ["AC1", "AC3"]).missing).toEqual(["AC3"]);
    expect(previewCard({ ...pkg, previewUrl: "https://pr-1.preview.test" }, "Checkout")).toContain("| AC2 | passed | [watch](memory://evidence/wi_1/videos/AC2-0.webm) |");
    await sandbox.destroy();
  });
});
