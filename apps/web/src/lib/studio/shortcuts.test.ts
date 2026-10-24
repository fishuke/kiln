import { describe, expect, it } from "vitest";
import { altTypes } from "./shortcuts";

const field = { tagName: "TEXTAREA" };

describe("altTypes", () => {
  it("is true for ⌥ characters and dead keys typed into a text field", () => {
    expect(altTypes({ key: "{", code: "Digit8", target: field })).toBe(true);
    expect(altTypes({ key: "~", code: "KeyN", target: field })).toBe(true);
    expect(altTypes({ key: "Dead", code: "KeyN", target: { tagName: "DIV", isContentEditable: true } })).toBe(true);
  });

  it("is false for shortcuts: outside text fields, Alt keeping the key's own character, or a non-ASCII ⌥ character", () => {
    expect(altTypes({ key: "{", code: "Digit8", target: { tagName: "BUTTON" } })).toBe(false);
    expect(altTypes({ key: "8", code: "Digit8", target: field })).toBe(false);
    expect(altTypes({ key: "π", code: "KeyP", target: field })).toBe(false);
    expect(altTypes({ key: "{", code: "Digit8", target: null })).toBe(false);
  });
});
