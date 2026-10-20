import { describe, expect, it } from "vitest";
import { INTEGRATIONS, integrationState, webhookUrl } from "./integration-catalog";

const spec = (id: string) => INTEGRATIONS.find((i) => i.id === id)!;
const legacy = { forge: "fake", tracker: "linear", chat: "fake", preview: "fake" };

describe("integration catalog", () => {
  it("lists every provider once, with env vars", () => {
    expect(new Set(INTEGRATIONS.map((i) => i.id)).size).toBe(INTEGRATIONS.length);
    for (const i of INTEGRATIONS) expect(i.env.length).toBeGreaterThan(0);
  });

  it("prefers the connections API", () => {
    expect(integrationState(spec("github"), { status: "connected" }, legacy)).toBe("connected");
    expect(integrationState(spec("jira"), { status: "pending_approval" }, legacy)).toBe("pending");
    expect(integrationState(spec("slack"), { status: "error", error: "x" }, legacy)).toBe("error");
  });

  it("falls back to the server summary", () => {
    expect(integrationState(spec("github"), undefined, { ...legacy, forge: "github" })).toBe("env");
    expect(integrationState(spec("slack"), undefined, { ...legacy, chat: "slack" })).toBe("env");
    expect(integrationState(spec("linear"), undefined, legacy)).toBe("off");
    expect(integrationState(spec("github"), undefined, undefined)).toBe("off");
  });

  it("builds webhook URLs", () => {
    expect(webhookUrl("https://kiln.example.com/", "/webhooks/github")).toBe("https://kiln.example.com/webhooks/github");
  });
});
