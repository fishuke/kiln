import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";

describe("templates", () => {
  it("match templates/templates.json, which the runner image is built from", () => {
    const file = JSON.parse(readFileSync(new URL("../../../templates/templates.json", import.meta.url), "utf8")) as unknown;
    expect(TEMPLATES).toEqual(file);
  });
});
