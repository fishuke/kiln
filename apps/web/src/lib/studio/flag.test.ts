import { describe, expect, it } from "vitest";
import { studioContextEnabled } from "./flag";

describe("studioContextEnabled", () => {
  it("is on only for KILN_STUDIO_CONTEXT=1", () => {
    expect(studioContextEnabled({ KILN_STUDIO_CONTEXT: "1" })).toBe(true);
    expect(studioContextEnabled({})).toBe(false);
    expect(studioContextEnabled({ KILN_STUDIO_CONTEXT: "true" })).toBe(false);
    expect(studioContextEnabled({ KILN_STUDIO_CONTEXT: "0" })).toBe(false);
  });
});
