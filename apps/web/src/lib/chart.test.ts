import { describe, expect, it } from "vitest";
import { areaPath, bucket, dayKeys, dayLabel, delta, labelIndexes, linePath, niceScale, parseRange, scaleLinear, stack } from "./chart";
import { toAlias, validateAlias } from "./alias";

describe("niceScale", () => {
  it("uses 0..4 for empty data", () => {
    expect(niceScale(0)).toEqual({ top: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  });
  it("rounds up to nice steps", () => {
    expect(niceScale(5.67).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(3.9).top).toBe(4);
    expect(niceScale(0.3).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceScale(870).top).toBe(1000);
  });
});

describe("scales and paths", () => {
  it("maps inverted ranges", () => {
    const y = scaleLinear([0, 4], [100, 0]);
    expect(y(0)).toBe(100);
    expect(y(4)).toBe(0);
    expect(y(1)).toBe(75);
  });
  it("builds line and area paths", () => {
    expect(linePath([[0, 10], [5, 0]])).toBe("M0.00,10.00L5.00,0.00");
    expect(areaPath([[0, 5], [10, 0]], [[0, 10], [10, 10]])).toBe("M0.00,5.00L10.00,0.00L10.00,10.00L0.00,10.00Z");
  });
});

describe("buckets", () => {
  const days = dayKeys(new Date("2026-10-14T05:00:00Z"), new Date("2026-10-20T23:00:00Z"));
  it("lists every day inclusive", () => {
    expect(days).toHaveLength(7);
    expect(dayLabel(days[0]!)).toBe("Oct 14");
  });
  it("sums per day and series and zero-fills", () => {
    const runs = [
      { at: "2026-10-19T10:00:00Z", agent: "code", cost: 1.5 },
      { at: "2026-10-19T11:00:00Z", agent: "code", cost: 1 },
      { at: "2026-10-20T11:00:00Z", agent: "review", cost: 2 },
      { at: "2026-09-01T11:00:00Z", agent: "review", cost: 9 },
    ];
    const { rows, series } = bucket(runs, days, (r) => r.at, (r) => r.agent, (r) => r.cost, ["foreman"]);
    expect(series).toEqual(["foreman", "code", "review"]);
    expect(rows[5]).toMatchObject({ key: "2026-10-19", code: 2.5, review: 0, foreman: 0 });
    expect(rows[6]).toMatchObject({ review: 2 });
    const st = stack(rows, series);
    expect(st.review![6]).toEqual([0, 2]);
    expect(st.review![5]).toEqual([2.5, 2.5]);
  });
});

describe("ranges and deltas", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("defaults to the last 7 days with an equal previous period", () => {
    const r = parseRange({}, now);
    expect(r.key).toBe("7d");
    expect(r.start.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(r.prevStart.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(r.prevEnd.getTime()).toBe(r.start.getTime() - 1);
  });
  it("accepts custom ranges", () => {
    const r = parseRange({ from: "2026-10-01", to: "2026-10-10" }, now);
    expect(r.key).toBe("custom");
    expect(r.label).toBe("Oct 1 – Oct 10");
  });
  it("computes deltas", () => {
    expect(delta(12, 10)).toBeCloseTo(0.2);
    expect(delta(5, 0)).toBeNull();
    expect(delta(null, 3)).toBeNull();
  });
  it("thins x labels", () => {
    expect(labelIndexes(30, 7)).toEqual([0, 5, 10, 15, 19, 24, 29]);
    expect(labelIndexes(3)).toEqual([0, 1, 2]);
  });
});

describe("foreman name", () => {
  it("derives an alias from a factory name", () => {
    expect(toAlias("Kiln Façade Team!")).toBe("kiln-facade-team");
    expect(toAlias("x".repeat(80))).toHaveLength(60);
  });
  it("validates", () => {
    expect(validateAlias("")).toMatch(/Enter/);
    expect(validateAlias("Kiln")).toMatch(/lowercase/);
    expect(validateAlias("-kiln")).toMatch(/Start/);
    expect(validateAlias("kiln_x")).toMatch(/only letters/);
    expect(validateAlias("a".repeat(61))).toMatch(/60/);
    expect(validateAlias("@shop", ["Shop"])).toMatch(/already used/);
    expect(validateAlias("shop", ["shop"], "shop")).toBeNull();
    expect(validateAlias("kiln", ["shop"])).toBeNull();
  });
});
