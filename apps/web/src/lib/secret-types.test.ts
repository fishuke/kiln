import { describe, expect, it } from "vitest";
import { parseDotenv, secretType, toSecretName, validSecretName } from "./secret-types";

describe("secret types", () => {
  it("validates and normalizes names", () => {
    expect(validSecretName("GITHUB_TOKEN")).toBe(true);
    expect(validSecretName("_x1")).toBe(true);
    expect(validSecretName("1abc")).toBe(false);
    expect(validSecretName("a-b")).toBe(false);
    expect(toSecretName("my api-key")).toBe("MY_API_KEY");
    expect(toSecretName("9lives")).toBe("_9LIVES");
  });

  it("describes what a run gets", () => {
    expect(secretType("raw").gives("SENTRY_TOKEN")).toContain("SENTRY_TOKEN");
    expect(secretType("claude_oauth_token").gives("")).toBe("CLAUDE_CODE_OAUTH_TOKEN");
    expect(secretType("nope").id).toBe("raw");
  });

  it("parses .env text", () => {
    expect(parseDotenv('# c\nA=1\nexport B="two words"\nC=\nbad line\nD=\'x=y\'')).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "two words" },
      { name: "D", value: "x=y" },
    ]);
  });
});
