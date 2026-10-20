import { describe, expect, it } from "vitest";
import { cronFromSchedule, cronProblem, describeCron, gmtLabel, nextRun, scheduleFromCron } from "./cron";

describe("describeCron", () => {
  it("describes the common shapes", () => {
    expect(describeCron("0 9 * * 1")).toBe("Weekly on Mon at 9:00 AM");
    expect(describeCron("30 14 * * *")).toBe("Daily at 2:30 PM");
    expect(describeCron("0 * * * *")).toBe("Hourly");
    expect(describeCron("15 * * * *")).toBe("Hourly at :15");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM UTC");
    expect(describeCron("0 3 1 * *")).toBe("Monthly on day 1 at 3:00 AM UTC");
  });

  it("describes descriptors and @every", () => {
    expect(describeCron("@daily")).toBe("Daily at 12:00 AM");
    expect(describeCron("@hourly")).toBe("Hourly");
    expect(describeCron("@weekly")).toBe("Weekly on Sun at 12:00 AM");
    expect(describeCron("@every 5m")).toBe("Every 5 minutes");
    expect(describeCron("@every 2h")).toBe("Every 2 hours");
    expect(describeCron("@every 1h30m")).toBe("Every 90 minutes");
  });

  it("shows the local time for an offset", () => {
    expect(describeCron("0 7 * * 1", 120)).toBe("Weekly on Mon at 9:00 AM");
    expect(describeCron("0 23 * * 0", 120)).toBe("Weekly on Mon at 1:00 AM");
  });

  it("falls back to the raw expression", () => {
    expect(describeCron("0 9 1 1 *")).toBe("Cron: 0 9 1 1 *");
    expect(describeCron("nonsense")).toBe("Cron: nonsense");
  });
});

describe("cronProblem", () => {
  it("accepts five fields and descriptors", () => {
    expect(cronProblem("0 9 * * 1")).toBeNull();
    expect(cronProblem("@every 10m")).toBeNull();
    expect(cronProblem("@midnight")).toBeNull();
  });
  it("rejects what the schema rejects", () => {
    expect(cronProblem("0 0 9 * * 1")).toMatch(/Six-field/);
    expect(cronProblem("TZ=Europe/Amsterdam 0 9 * * *")).toMatch(/UTC/);
    expect(cronProblem("@every 30s")).toMatch(/one minute/);
    expect(cronProblem("61 * * * *")).toMatch(/minute/);
    expect(cronProblem("@sometimes")).toMatch(/Unknown/);
  });
});

describe("schedule form", () => {
  it("round-trips weekly across midnight with an offset", () => {
    const form = { frequency: "weekly" as const, minute: 30, hour: 1, day: 1, cron: "" };
    const cron = cronFromSchedule(form, 120);
    expect(cron).toBe("30 23 * * 0");
    expect(scheduleFromCron(cron, 120)).toMatchObject({ frequency: "weekly", minute: 30, hour: 1, day: 1 });
  });
  it("round-trips daily and hourly", () => {
    expect(cronFromSchedule({ frequency: "daily", minute: 0, hour: 9, day: 0, cron: "" }, -300)).toBe("0 14 * * *");
    expect(scheduleFromCron("0 14 * * *", -300)).toMatchObject({ frequency: "daily", hour: 9, minute: 0 });
    expect(cronFromSchedule({ frequency: "hourly", minute: 15, hour: 0, day: 0, cron: "" })).toBe("15 * * * *");
  });
  it("treats anything else as custom", () => {
    expect(scheduleFromCron("*/5 * * * *").frequency).toBe("custom");
    expect(scheduleFromCron("@every 5m").frequency).toBe("custom");
    expect(cronFromSchedule({ frequency: "custom", minute: 0, hour: 0, day: 0, cron: " 0 9 1 * * " })).toBe("0 9 1 * *");
  });
});

describe("nextRun", () => {
  it("finds the next UTC fire time", () => {
    const after = new Date("2026-10-20T10:00:00Z"); // a Tuesday
    expect(nextRun("0 9 * * 1", after)?.toISOString()).toBe("2026-10-26T09:00:00.000Z");
    expect(nextRun("@every 5m", after)?.toISOString()).toBe("2026-10-20T10:05:00.000Z");
    expect(nextRun("bad", after)).toBeNull();
  });
});

describe("gmtLabel", () => {
  it("formats offsets", () => {
    expect(gmtLabel(120)).toBe("GMT+2");
    expect(gmtLabel(-330)).toBe("GMT-5:30");
    expect(gmtLabel(0)).toBe("GMT");
  });
});
