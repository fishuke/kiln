import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/kiln", () => ({ api: {}, safe: async <T>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback) }));

const { FALLBACK_MODELS } = await import("./resources");

describe("FALLBACK_MODELS", () => {
  it("offers the Fable models in every picker", () => {
    expect(FALLBACK_MODELS).toContain("claude-fable-5-1");
    expect(FALLBACK_MODELS).toContain("claude-fable-5");
  });
});
