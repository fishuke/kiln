import { describe, expect, it } from "vitest";
import { barPercent, fillDays, formatUsd, monthLabel, usageLabel, usageTone, usedFraction, withShares } from "./usage";

describe("usage formatting", () => {
  it("formats dollars", () => {
    expect(formatUsd(0.3)).toBe("$0.30");
    expect(formatUsd(12.4)).toBe("$12.40");
    expect(formatUsd(200)).toBe("$200.00");
    expect(formatUsd(1250.6)).toBe("$1,251");
    expect(formatUsd(-2)).toBe("-$2.00");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("labels the sidebar footer", () => {
    expect(usageLabel({ monthlyUsd: 200, spentThisMonthUsd: 0.3, exceeded: false })).toEqual({ label: "$0.30 of $200.00 used", tone: "ok" });
    expect(usageLabel({ monthlyUsd: 100, spentThisMonthUsd: 85, exceeded: false }).tone).toBe("warn");
    expect(usageLabel({ monthlyUsd: 100, spentThisMonthUsd: 120, exceeded: true }).tone).toBe("over");
  });

  it("handles a zero limit", () => {
    expect(usedFraction({ monthlyUsd: 0, spentThisMonthUsd: 0 })).toBe(0);
    expect(usageTone({ monthlyUsd: 0, spentThisMonthUsd: 1, exceeded: true })).toBe("over");
  });

  it("clamps bars", () => {
    expect(barPercent(50, 200)).toBe(25);
    expect(barPercent(300, 200)).toBe(100);
    expect(barPercent(1, 0)).toBe(0);
    expect(barPercent(-1, 10)).toBe(0);
  });

  it("computes shares and folds the tail into Other", () => {
    const rows = withShares(
      [
        { key: "a", costUsd: 1, runs: 1 },
        { key: "b", costUsd: 3, runs: 2 },
        { key: "c", costUsd: 0.5, runs: 1 },
        { key: "d", costUsd: 0.5, runs: 4 },
      ],
      2,
    );
    expect(rows.map((r) => r.key)).toEqual(["b", "a", "Other"]);
    expect(rows[0]!.share).toBe(60);
    expect(rows[2]).toMatchObject({ costUsd: 1, runs: 5, share: 20 });
  });

  it("fills missing days", () => {
    const days = fillDays([{ key: "2026-10-02", costUsd: 1, runs: 1 }], "2026-10-01T00:00:00.000Z", "2026-10-03T10:00:00Z");
    expect(days.map((d) => [d.key, d.costUsd])).toEqual([
      ["2026-10-01", 0],
      ["2026-10-02", 1],
      ["2026-10-03", 0],
    ]);
  });

  it("names the month", () => {
    expect(monthLabel("2026-10-01T00:00:00.000Z")).toBe("October 2026");
  });
});
