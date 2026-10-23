import { describe, expect, it } from "vitest";
import { narrate } from "./narrator";
import type { NarratorInput } from "./types";

const base: NarratorInput = { focus: { app: "a1", chat: "c1" }, quiet: false, idle: false };
const needsYou = { type: "studio.needs_you", payload: { appId: "a1", chatId: "c2", question: "Which colour?", reason: "question", priority: "needs_you" } };
const finished = (chatId: string) => ({
  type: "studio.turn_finished",
  payload: { appId: "a1", chatId, turnId: "t1", title: "Blue header", summary: "The header is blue now.", changed: true, priority: "finished" },
});

describe("narrate", () => {
  it("says needs-you at the next pause and badges it", () => {
    expect(narrate(needsYou, base)).toEqual({
      command: { type: "say", text: "Which colour?", delegation: null },
      badge: { appId: "a1", chatId: "c2", text: "Which colour?", priority: "needs_you" },
    });
  });

  it("only thinks needs-you in quiet mode", () => {
    expect(narrate(needsYou, { ...base, quiet: true })).toEqual({
      command: { type: "think", text: "Which colour?", delegation: null },
      badge: { appId: "a1", chatId: "c2", text: "Which colour?", priority: "needs_you" },
    });
  });

  it("says a finished turn in the focused chat as title: summary", () => {
    expect(narrate(finished("c1"), base)).toEqual({
      command: { type: "say", text: "Blue header: The header is blue now.", delegation: null },
      badge: { appId: "a1", chatId: "c1", text: "Blue header", priority: "finished" },
    });
  });

  it("says a finished turn elsewhere only while the person is idle; otherwise thinks it", () => {
    expect(narrate(finished("c2"), { ...base, idle: true }).command).toMatchObject({ type: "say" });
    expect(narrate(finished("c2"), base)).toMatchObject({
      command: { type: "think", text: "Blue header: The header is blue now." },
      badge: { priority: "finished" },
    });
  });

  it("never speaks a finished turn in quiet mode", () => {
    expect(narrate(finished("c1"), { ...base, quiet: true, idle: true }).command).toMatchObject({ type: "think" });
  });

  it("says a title alone when the turn has no summary", () => {
    const e = finished("c1");
    delete (e.payload as { summary?: string }).summary;
    expect(narrate(e, base).command).toEqual({ type: "say", text: "Blue header", delegation: null });
  });

  it("treats a failed App setup as needs-you", () => {
    expect(narrate({ type: "studio.app_failed", payload: { appId: "a3", error: "clone failed", priority: "needs_you" } }, base)).toEqual({
      command: { type: "say", text: "An app failed to set up: clone failed", delegation: null },
      badge: { appId: "a3", text: "An app failed to set up: clone failed", priority: "needs_you" },
    });
  });

  it("thinks other finished events", () => {
    expect(
      narrate(
        { type: "studio.version_created", payload: { appId: "a1", versionId: "v1", title: "Blue header", kind: "apply", priority: "finished" } },
        { ...base, idle: true },
      ),
    ).toEqual({
      command: { type: "think", text: "New version: Blue header", delegation: null },
      badge: { appId: "a1", text: "New version: Blue header", priority: "finished" },
    });
    expect(
      narrate(
        { type: "studio.pull_request_state_changed", payload: { appId: "a1", pullRequestId: "pr1", state: "merged", url: "https://x", priority: "finished" } },
        base,
      ).command,
    ).toEqual({ type: "think", text: "The pull request is now merged.", delegation: null });
  });

  it("is silent on progress and on events that aren't Studio's", () => {
    expect(narrate({ type: "studio.turn_started", payload: { appId: "a1", chatId: "c1", turnId: "t1", priority: "progress" } }, base)).toEqual({});
    expect(narrate({ type: "studio.preview_failed", payload: { appId: "a1", reason: "x", priority: "progress" } }, base)).toEqual({});
    expect(narrate({ type: "run.finished", payload: { priority: "needs_you" } }, base)).toEqual({});
    expect(narrate({ type: "studio.needs_you", payload: "garbage" }, base)).toEqual({});
  });
});
