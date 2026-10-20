import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, notificationLabel, withDefaults } from "./notifications";

describe("notification preferences", () => {
  it("lists blocked and failed work next to the gate kinds", () => {
    expect(NOTIFICATION_KINDS.map((k) => k.key)).toEqual(["spec", "preview", "question", "merge", "custom", "blocked", "failed"]);
  });

  it("fills kinds an older account has no preference for", () => {
    const prefs = withDefaults({ spec: { email: false, slack: true, discord: false } } as never);
    expect(prefs.spec).toEqual({ email: false, slack: true, discord: false });
    expect(prefs.blocked).toEqual({ email: true, slack: true, discord: true });
    expect(Object.keys(prefs)).toHaveLength(7);
  });

  it("labels history rows", () => {
    expect(notificationLabel("digest")).toBe("Daily digest");
    expect(notificationLabel("failed")).toBe("Failed work");
    expect(notificationLabel("other")).toBe("other");
  });
});
