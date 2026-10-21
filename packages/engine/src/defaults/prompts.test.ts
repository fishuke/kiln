import { describe, expect, it } from "vitest";
import { foremanPrompt, implementPrompt, reviewPrompt } from "./prompts";

describe("default prompts", () => {
  it("implement: guidance files, one pull request, honest verification, report and follow-ups", () => {
    const p = implementPrompt();
    expect(p).toContain("`AGENTS.md`");
    expect(p).toMatch(/Never start a second branch or pull request/);
    expect(p).toMatch(/History .* goes in commit messages, never in code or test names/);
    expect(p).toMatch(/Never claim a check passed that you did not run/);
    expect(p).toMatch(/Delete scaffolding tests/);
    expect(p).toMatch(/do not wait for CI/);
    expect(p).toMatch(/in the `pr` field of your result/);
    expect(p).toMatch(/Title: a conventional commit/);
    expect(p).toMatch(/`## Why`:[\s\S]*`## What`: at most three bullets[\s\S]*`## Verification`:/);
    expect(p).toMatch(/stays open with a reply that says why/);
    expect(p).not.toMatch(/write Summary, Changes and Verification/);
  });

  it("foreman: hand-off capture, attribution, thread ownership and briefs by stage", () => {
    const p = foremanPrompt({ alias: "shop", agents: ["triage", "spec", "implement", "review"] });
    expect(p).toMatch(/one attribution comment/);
    expect(p).toMatch(/put one capture next to that message/);
    expect(p).toMatch(/replies in its thread and resolves it/);
    expect(p).toMatch(/Context grows by stage/);
    expect(p).toContain("the label `factory:shop` for an agent that opens issues or pull requests");
    expect(p).toMatch(/Do not repeat what the thread/);
  });

  it("review: flags history comments and scaffolding tests", () => {
    expect(reviewPrompt()).toMatch(/tests that only scaffold/);
  });
});
