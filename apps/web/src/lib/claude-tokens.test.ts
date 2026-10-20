import { describe, expect, it } from "vitest";
import { byHeadroom, resetsIn, tokenStatus, usageLine } from "./claude-tokens";

const now = new Date("2026-10-20T12:00:00Z");

describe("Claude token pool display", () => {
  it("labels statuses", () => {
    expect(tokenStatus({ status: "ok" })).toEqual({ label: "Working", tone: "green" });
    expect(tokenStatus({ status: "invalid" }).tone).toBe("red");
    expect(tokenStatus({ status: "unknown" }).label).toBe("Not used yet");
  });

  it("formats usage and resets", () => {
    expect(resetsIn("2026-10-20T14:10:00Z", now)).toBe("in 2h 10m");
    expect(resetsIn("2026-10-23T16:00:00Z", now)).toBe("in 3d 4h");
    expect(resetsIn("2026-10-20T11:00:00Z", now)).toBe("now");
    expect(usageLine({ utilization: 0.421, resetsAt: "2026-10-20T12:30:00Z" }, now)).toBe("42% used · resets in 30m");
    expect(usageLine(undefined)).toBeUndefined();
  });

  it("orders the pool the way runs pick tokens", () => {
    const e = (name: string, status: "ok" | "unknown" | "limited" | "invalid", u = 0) => ({ name, status, scope: "team" as const, updatedAt: "", fiveHour: { utilization: u } });
    expect(byHeadroom([e("A", "invalid"), e("B", "ok", 0.8), e("C", "limited", 1), e("D", "ok", 0.1)]).map((x) => x.name)).toEqual(["D", "B", "C", "A"]);
  });
});
