import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kilnFromEnv, sandboxUrl } from "./config";

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

describe("the API's URL for sandboxes (#156)", () => {
  it("is the Docker host for a localhost API, the public URL otherwise, and KILN_SANDBOX_URL when set", () => {
    expect(sandboxUrl({}, "http://localhost:4000", "docker")).toBe("http://host.docker.internal:4000");
    expect(sandboxUrl({}, "http://127.0.0.1:4100/", "docker")).toBe("http://host.docker.internal:4100");
    expect(sandboxUrl({}, "https://api.kiln.example.com", "docker")).toBe("https://api.kiln.example.com");
    expect(sandboxUrl({}, "http://localhost:4000", "kubernetes")).toBe("http://localhost:4000");
    expect(sandboxUrl({ KILN_SANDBOX_URL: "http://api:4000" }, "http://localhost:4000", "docker")).toBe("http://api:4000");
    expect(kilnFromEnv(env({})).kiln.options.sandboxUrl).toBe("http://host.docker.internal:4000");
  });
});
