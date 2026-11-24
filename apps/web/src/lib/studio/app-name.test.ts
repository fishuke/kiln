import { describe, expect, it } from "vitest";
import { nameFromPrompt } from "./app-name";

describe("nameFromPrompt", () => {
  it("names an App from the prompt it is created with", () => {
    expect(nameFromPrompt("make a todo app")).toBe("Todo app");
    expect(nameFromPrompt("I want a recipe box I can search by ingredient")).toBe("Recipe box I can search");
    expect(nameFromPrompt("Daily habits I can tick off, with a streak for each")).toBe("Daily habits I can tick");
    expect(nameFromPrompt("Can you build me an expense splitter for trips.")).toBe("Expense splitter for trips");
    expect(nameFromPrompt("   ")).toBe("");
  });
});
