import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { fileKinds, jsonSchemaFor, type FileKind } from "./index";

const fixtures = new URL("../fixtures/", import.meta.url);

function load(dir: "valid" | "invalid") {
  return readdirSync(new URL(`${dir}/`, fixtures)).map((file) => {
    const kind = file.split("__")[0] as FileKind;
    return { file, kind, data: parse(readFileSync(new URL(`${dir}/${file}`, fixtures), "utf8")) };
  });
}

describe("definition schemas", () => {
  const valid = load("valid");
  const invalid = load("invalid");

  it("has at least 40 fixtures", () => {
    expect(valid.length + invalid.length).toBeGreaterThanOrEqual(40);
  });

  it.each(valid)("accepts valid/$file", ({ kind, data }) => {
    const result = fileKinds[kind].safeParse(data);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(invalid)("rejects invalid/$file", ({ kind, data }) => {
    expect(fileKinds[kind].safeParse(data).success).toBe(false);
  });

  it("rejects unknown keys on every object kind", () => {
    for (const { kind, data } of valid) {
      if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
      const result = fileKinds[kind].safeParse({ ...data, notAKey: true });
      expect(result.success, kind).toBe(false);
    }
  });

  it("exports a JSON Schema for every kind", () => {
    for (const kind of Object.keys(fileKinds) as FileKind[]) {
      const schema = jsonSchemaFor(kind);
      expect(schema).toHaveProperty("$schema");
    }
  });
});
