import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kilnFromEnv } from "./config";

const repo = { owner: "acme", name: "web" };
const env = (extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ KILN_DATA_DIR: mkdtempSync(join(tmpdir(), "kiln-ghe-")), GITHUB_TOKEN: "t", ...extra });

describe("GITHUB_URL: a GitHub Enterprise Server as the forge", () => {
  it("clones from the configured host and installs apps there", () => {
    const { kiln } = kilnFromEnv(env({ GITHUB_URL: "https://ghe.example.com" }));
    expect(kiln.forge.cloneUrl(repo, "tok")).toBe("https://x-access-token:tok@ghe.example.com/acme/web.git");
    expect(kiln.options.githubUrl).toBe("https://ghe.example.com");
  });

  it("stays on github.com when unset", () => {
    const { kiln } = kilnFromEnv(env({}));
    expect(kiln.forge.cloneUrl(repo)).toBe("https://github.com/acme/web.git");
    expect(kiln.options.githubUrl).toBe("https://github.com");
  });
});
