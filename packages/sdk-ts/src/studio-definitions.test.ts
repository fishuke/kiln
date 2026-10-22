import type { AppSettings, AppSettingsPatch, DefinitionVersion } from "@kiln/studio";
import { describe, expect, expectTypeOf, it } from "vitest";
import { studioScopePath, type StudioAppSettings, type StudioDefinitionVersion, type StudioSettingsPatch } from "./studio-definitions";

describe("Studio definition types", () => {
  it("stay assignable to @kiln/studio's", () => {
    expectTypeOf<AppSettings>().toEqualTypeOf<StudioAppSettings>();
    expectTypeOf<AppSettingsPatch>().toEqualTypeOf<StudioSettingsPatch>();
    expectTypeOf<DefinitionVersion>().toEqualTypeOf<StudioDefinitionVersion>();
  });

  it("maps scopes to API paths", () => {
    expect(studioScopePath("team")).toBe("team");
    expect(studioScopePath({ app: "sa_1" })).toBe("apps/sa_1");
    expect(studioScopePath({ project: "proj 1" })).toBe("projects/proj%201");
  });
});
