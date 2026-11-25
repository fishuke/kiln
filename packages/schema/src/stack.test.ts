import { describe, expect, it } from "vitest";
import { resolveStackEnv, Stack, stackProblems, startOrder } from "./stack";

const parse = (raw: unknown) => Stack.parse(raw);
const shop = () =>
  parse({
    apiVersion: "kiln/v1",
    kind: "Stack",
    name: "shop",
    services: {
      postgres: { kind: "datastore", start: "postgres-start", port: 5432 },
      api: { repo: "acme/api", start: "pnpm dev", port: 3000, health: "/health", depends_on: ["postgres"], env: { DATABASE_URL: "postgres://localhost:5432/shop" } },
      web: {
        repo: "acme/web",
        surface: "Customer site",
        start: "pnpm dev -p 4000",
        port: 4000,
        depends_on: ["api"],
        env: { NEXT_PUBLIC_API_URL: "${services.api.url}", API_URL: "${services.api.url}/v1" },
        env_public: ["NEXT_PUBLIC_API_URL"],
      },
      i18n: { repo: "acme/i18n", kind: "library", link: { into: ["web"] } },
    },
    merge_order: ["i18n", "api", "web"],
  });

describe("Stack", () => {
  it("parses a stack with defaults", () => {
    const s = shop();
    expect(s.services.api!.kind).toBe("service");
    expect(s.services.api!.depends_on).toEqual(["postgres"]);
    expect(s.services.web!.env_public).toEqual(["NEXT_PUBLIC_API_URL"]);
  });

  it("rejects service names that can't be part of a host name", () => {
    expect(() => parse({ name: "x", services: { Api_1: { start: "x" } } })).toThrow();
  });
});

describe("stackProblems", () => {
  it("finds nothing wrong in a good stack", () => {
    expect(stackProblems(shop(), ["acme/api", "acme/web", "acme/i18n"])).toEqual([]);
  });

  it("finds cycles, duplicate ports, unknown references and repositories outside the factory", () => {
    const s = shop();
    s.services.postgres!.depends_on = ["web"];
    s.services.web!.port = 3000;
    s.services.web!.env.X = "${services.cache.url}";
    s.merge_order = ["api", "nope"];
    const problems = stackProblems(s, ["acme/api", "acme/web"]);
    expect(problems.join("\n")).toMatch(/depends_on has a cycle: .*postgres/);
    expect(problems).toContain("port 3000 is used by api and web");
    expect(problems).toContain("web: env X names an unknown service cache");
    expect(problems).toContain("merge_order names an unknown service nope");
    expect(problems).toContain("i18n: repository acme/i18n is not in factory.yaml repositories");
  });

  it("needs a start command and a port for a service others reach by URL", () => {
    const s = shop();
    delete s.services.api!.port;
    expect(stackProblems(s, ["acme/api", "acme/web", "acme/i18n"])).toContain("api: web reads ${services.api.url}, so api needs a port");
  });
});

describe("startOrder", () => {
  it("starts dependencies first, libraries never", () => {
    expect(startOrder(shop())).toEqual(["postgres", "api", "web"]);
  });
});

describe("resolveStackEnv", () => {
  it("uses the in-sandbox address server side and the preview URL for public names", () => {
    const env = resolveStackEnv(shop(), "web", { api: "https://pr-1-api.preview.test" });
    expect(env).toEqual({ NEXT_PUBLIC_API_URL: "https://pr-1-api.preview.test", API_URL: "http://localhost:3000/v1" });
  });

  it("lets project environment values sit underneath; the stack's env wins", () => {
    expect(resolveStackEnv(shop(), "api", {}, { DATABASE_URL: "x", TZ: "UTC" })).toEqual({ DATABASE_URL: "postgres://localhost:5432/shop", TZ: "UTC" });
  });
});
