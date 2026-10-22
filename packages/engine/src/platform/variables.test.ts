import { describe, expect, it } from "vitest";
import { createTestKiln } from "../testing";
import { C } from "../types";

function setup(secretKey = "test-key") {
  const { kiln } = createTestKiln({ secretKey });
  const team = kiln.teams.ensureDefaultTeam();
  const project = kiln.planning.createProject({ name: "Portal", owner: "po@acme.test", factories: ["webapp"] });
  return { kiln, team: team.id, project: project.id };
}

describe("variables", () => {
  it("overrides team, then project, then factory", () => {
    const { kiln, team, project } = setup();
    const v = kiln.variables;
    v.set(
      {
        scope: "team",
        owner: team,
        environment: "preview",
        variables: [
          { key: "API_URL", value: "https://team" },
          { key: "REGION", value: "eu" },
        ],
      },
      "a",
    );
    v.set(
      {
        scope: "project",
        owner: project,
        environment: "preview",
        variables: [
          { key: "API_URL", value: "https://project" },
          { key: "FLAG", value: "1" },
        ],
      },
      "a",
    );
    v.set({ scope: "factory", owner: "webapp", environment: "preview", variables: [{ key: "FLAG", value: "2" }] }, "a");
    const r = v.forFactory("webapp")!;
    expect(r.env).toEqual({ API_URL: "https://project", REGION: "eu", FLAG: "2" });
    expect(r.sources.API_URL).toMatchObject({ scope: "project", owner: project });
    expect(r.sources.FLAG).toMatchObject({ scope: "factory", owner: "webapp" });
    expect(r.sources.REGION).toMatchObject({ scope: "team" });
  });

  it("overrides team, then project, then App", () => {
    const { kiln, team, project } = setup();
    const v = kiln.variables;
    v.set(
      {
        scope: "team",
        owner: team,
        environment: "preview",
        variables: [
          { key: "A", value: "team" },
          { key: "B", value: "team" },
          { key: "C", value: "team" },
        ],
      },
      "a",
    );
    v.set(
      {
        scope: "project",
        owner: project,
        environment: "preview",
        variables: [
          { key: "B", value: "project" },
          { key: "C", value: "project" },
        ],
      },
      "a",
    );
    v.set({ scope: "app", owner: "app_1", team, environment: "preview", variables: [{ key: "C", value: "app" }] }, "a");
    expect(v.forApp({ id: "app_1", team, projectId: project }).env).toEqual({ A: "team", B: "project", C: "app" });
    expect(v.forApp({ id: "app_1", team }).env).toEqual({ A: "team", B: "team", C: "app" });
  });

  it("keeps environments apart", () => {
    const { kiln, project, team } = setup();
    kiln.variables.set({ scope: "project", owner: project, environment: "production", variables: [{ key: "API_URL", value: "https://prod" }] }, "a");
    expect(kiln.variables.resolve({ team, project, environment: "preview" }).env).toEqual({});
    expect(kiln.variables.resolve({ team, project, environment: "production" }).env).toEqual({ API_URL: "https://prod" });
  });

  it("gives a factory in no project nothing", () => {
    const { kiln } = createTestKiln();
    const team = kiln.teams.ensureDefaultTeam();
    kiln.variables.set({ scope: "team", owner: team.id, environment: "preview", variables: [{ key: "A", value: "1" }] }, "a");
    expect(kiln.variables.forFactory("webapp")).toBeUndefined();
  });

  it("seals secrets, never returns them, and keeps a secret saved without a value", () => {
    const { kiln, project } = setup();
    const view = kiln.variables.set(
      {
        scope: "project",
        owner: project,
        environment: "preview",
        variables: [
          { key: "TOKEN", value: "s3cret-value-1234", secret: true },
          { key: "URL", value: "https://x" },
        ],
      },
      "a",
    );
    expect(view.variables).toEqual([
      { key: "TOKEN", secret: true },
      { key: "URL", secret: false, value: "https://x" },
    ]);
    expect(JSON.stringify(kiln.store.list("variables"))).not.toContain("s3cret-value-1234");
    expect(JSON.stringify(kiln.store.list(C.audit))).not.toContain("s3cret-value-1234");
    kiln.variables.set(
      {
        scope: "project",
        owner: project,
        environment: "preview",
        variables: [
          { key: "TOKEN", secret: true },
          { key: "URL", value: "https://y" },
        ],
      },
      "b",
    );
    const r = kiln.variables.forFactory("webapp")!;
    expect(r.env).toEqual({ TOKEN: "s3cret-value-1234", URL: "https://y" });
    expect(r.secretValues).toEqual(["s3cret-value-1234"]);
    expect(kiln.variables.list("project", project)[0]!.variables[0]).toEqual({ key: "TOKEN", secret: true });
  });

  it("rejects bad input", () => {
    const { kiln, project } = setup();
    const set =
      (variables: { key: string; value?: string; secret?: boolean }[], environment = "preview") =>
      () =>
        kiln.variables.set({ scope: "project", owner: project, environment, variables }, "a");
    expect(set([{ key: "NEW", secret: true }])).toThrow("NEW needs a value");
    expect(set([{ key: "KILN_URL", value: "x" }])).toThrow("KILN_ is reserved");
    expect(set([{ key: "bad-key", value: "x" }])).toThrow("letters, digits and underscores");
    expect(
      set([
        { key: "A", value: "1" },
        { key: "A", value: "2" },
      ]),
    ).toThrow("A is listed twice");
    expect(set([{ key: "A", value: "1" }], "Prod!")).toThrow("environment names");
  });

  it("deletes a layer", () => {
    const { kiln, project } = setup();
    kiln.variables.set({ scope: "project", owner: project, environment: "preview", variables: [{ key: "A", value: "1" }] }, "a");
    kiln.variables.delete("project", project, "preview", "a");
    expect(kiln.variables.list("project", project)).toEqual([]);
    expect(() => kiln.variables.delete("project", project, "preview", "a")).toThrow("no preview variables");
  });
});
