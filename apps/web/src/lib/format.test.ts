import { describe, expect, it } from "vitest";
import { bytes, duration, pct, stateLabel, stateTone, timeAgo, usd } from "./format";

describe("format", () => {
  it("formats byte sizes and uptimes", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(8 * 1024 ** 3)).toBe("8.0 GB");
    expect(bytes(120 * 1024 ** 3)).toBe("120 GB");
    expect(duration(93784)).toBe("1d 2h");
    expect(duration(3720)).toBe("1h 2m");
    expect(duration(59)).toBe("0m");
  });

  it("formats time, money and percentages", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    expect(timeAgo("2026-10-20T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-20T10:00:00Z", now)).toBe("2h ago");
    expect(timeAgo("2026-10-15T12:00:00Z", now)).toBe("5d ago");
    expect(usd(0.4)).toBe("$0.40");
    expect(usd(28.666)).toBe("$28.67");
    expect(usd(null)).toBe("—");
    expect(pct(0.32)).toBe("32%");
  });

  it("labels states and highlights the ones waiting on people", () => {
    expect(stateLabel("awaiting_spec")).toBe("Spec approval");
    expect(stateTone("handed_off")).toContain("amber");
    expect(stateTone("complete")).toContain("emerald");
  });
});
