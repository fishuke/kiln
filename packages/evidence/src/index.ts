import type { Sandbox } from "@kiln/sandbox";
import type { ObjectStore } from "@kiln/store";

export type TestCase = { name: string; suite?: string; status: "passed" | "failed" | "skipped"; durationMs: number; message?: string };
export type TestReport = { total: number; passed: number; failed: number; skipped: number; cases: TestCase[] };

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : undefined;
}

function decode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** JUnit XML, as written by Vitest, Jest, Playwright, pytest and most CI tools. */
export function parseJUnit(xml: string): TestReport {
  const cases: TestCase[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const tag = m[1]!;
    const inner = m[3] ?? "";
    const failure = /<(failure|error)\b([^>]*)>?/.exec(inner);
    const status = failure ? "failed" : /<skipped\b/.test(inner) ? "skipped" : "passed";
    cases.push({
      name: attr(tag, "name") ?? "unnamed",
      suite: attr(tag, "classname"),
      status,
      durationMs: Math.round(Number(attr(tag, "time") ?? 0) * 1000),
      message: failure ? (attr(failure[2] ?? "", "message") ?? "failed") : undefined,
    });
  }
  return summarize(cases);
}

function summarize(cases: TestCase[]): TestReport {
  return {
    total: cases.length,
    passed: cases.filter((c) => c.status === "passed").length,
    failed: cases.filter((c) => c.status === "failed").length,
    skipped: cases.filter((c) => c.status === "skipped").length,
    cases,
  };
}

type PwSpec = { title: string; tests: { results: { status: string; duration: number; attachments?: { name: string; path?: string; contentType: string }[]; error?: { message?: string } }[] }[] };
type PwSuite = { title: string; specs?: PwSpec[]; suites?: PwSuite[] };

export type PlaywrightTest = TestCase & { videos: string[]; traces: string[]; criteria: string[] };

/** Acceptance criteria are tagged in test titles, e.g. "AC1: user can log in". */
export function criteriaIn(title: string): string[] {
  return [...title.matchAll(/\bAC(\d+)\b/g)].map((m) => `AC${m[1]}`);
}

export function parsePlaywrightJson(report: { suites?: PwSuite[] }): PlaywrightTest[] {
  const out: PlaywrightTest[] = [];
  const walk = (suite: PwSuite, prefix: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const result = test.results.at(-1);
        if (!result) continue;
        const attachments = result.attachments ?? [];
        out.push({
          name: spec.title,
          suite: [...prefix, suite.title].filter(Boolean).join(" › "),
          status: result.status === "passed" ? "passed" : result.status === "skipped" ? "skipped" : "failed",
          durationMs: result.duration,
          message: result.error?.message,
          videos: attachments.filter((a) => a.contentType.startsWith("video/") && a.path).map((a) => a.path!),
          traces: attachments.filter((a) => a.name === "trace" && a.path).map((a) => a.path!),
          criteria: criteriaIn(spec.title),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...prefix, suite.title]);
  };
  for (const s of report.suites ?? []) walk(s, []);
  return out;
}

export type EvidencePackage = {
  workItemId: string;
  tests?: TestReport;
  criteria: Record<string, { status: TestCase["status"]; videoUrl?: string; test: string }>;
  previewUrl?: string;
  specUrl?: string;
  prUrl?: string;
  artifacts: { key: string; url: string; kind: "video" | "trace" | "report" }[];
};

/**
 * Runs Playwright in the sandbox (video and trace on) and uploads one video per acceptance criterion.
 * `reportPath` is where the JSON reporter writes inside `cwd`.
 */
export async function collectPlaywrightEvidence(input: {
  sandbox: Sandbox;
  store: ObjectStore;
  workItemId: string;
  cwd: string;
  run?: boolean;
  command?: string;
  reportPath?: string;
}): Promise<EvidencePackage> {
  const reportPath = input.reportPath ?? "playwright-report/results.json";
  if (input.run !== false) {
    await input.sandbox.exec(
      input.command ?? `npx playwright test --reporter=json --output=test-results 2>/dev/null > ${reportPath} || true`,
      { cwd: input.cwd, env: { PLAYWRIGHT_VIDEO: "on", PLAYWRIGHT_TRACE: "on" } },
    );
  }
  const raw = await input.sandbox.readFile(`${input.cwd}/${reportPath}`);
  const pkg: EvidencePackage = { workItemId: input.workItemId, criteria: {}, artifacts: [] };
  if (!raw) return pkg;
  const tests = parsePlaywrightJson(JSON.parse(raw));
  pkg.tests = summarize(tests);
  const report = await input.store.put(`evidence/${input.workItemId}/playwright.json`, raw, "application/json");
  pkg.artifacts.push({ ...report, kind: "report" });
  for (const test of tests) {
    for (const [i, video] of test.videos.entries()) {
      const path = video.startsWith("/") ? video : `${input.cwd}/${video}`;
      const bytes = await input.sandbox.readBytes(path);
      if (!bytes) continue;
      const crit = test.criteria[i] ?? test.criteria[0] ?? `test-${slug(test.name)}`;
      const put = await input.store.put(`evidence/${input.workItemId}/videos/${crit}-${i}.webm`, bytes, "video/webm");
      pkg.artifacts.push({ ...put, kind: "video" });
      for (const c of test.criteria.length ? test.criteria : [crit]) {
        pkg.criteria[c] = { status: test.status, videoUrl: put.url, test: test.name };
      }
    }
    for (const c of test.criteria) pkg.criteria[c] ??= { status: test.status, test: test.name };
  }
  return pkg;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/** Every listed criterion has a passing test with a video. */
export function criteriaCovered(pkg: EvidencePackage, criteria: string[]): { ok: boolean; missing: string[] } {
  const missing = criteria.filter((c) => pkg.criteria[c]?.status !== "passed" || !pkg.criteria[c]?.videoUrl);
  return { ok: missing.length === 0, missing };
}

/** The card posted to the PR and the source thread. */
export function previewCard(pkg: EvidencePackage, title: string): string {
  const lines = [`### ${title}`, ""];
  if (pkg.previewUrl) lines.push(`Preview: ${pkg.previewUrl}`);
  if (pkg.prUrl) lines.push(`Pull request: ${pkg.prUrl}`);
  if (pkg.specUrl) lines.push(`Spec: ${pkg.specUrl}`);
  if (pkg.tests) lines.push(`Tests: ${pkg.tests.passed} passed, ${pkg.tests.failed} failed, ${pkg.tests.skipped} skipped`);
  const crit = Object.entries(pkg.criteria).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  if (crit.length) {
    lines.push("", "| Criterion | Result | Video |", "| --- | --- | --- |");
    for (const [c, v] of crit) lines.push(`| ${c} | ${v.status} | ${v.videoUrl ? `[watch](${v.videoUrl})` : "—"} |`);
  }
  return lines.join("\n");
}
