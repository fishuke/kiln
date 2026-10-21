import { describe, expect, it } from "vitest";
import { CUSTOM_SUGGESTION, fieldsError, fillTemplate, MCP_TEMPLATES, parseMcpJson, pickVariant, secretRefs, toMcpJson, toMcpName } from "./mcp-config";

describe("MCP config", () => {
  it("parses the named, bare and Claude Code shapes", () => {
    expect(parseMcpJson(CUSTOM_SUGGESTION)).toEqual({ ok: true, name: "server-name", server: { url: "https://example.com/mcp", headers: { Authorization: "Bearer {{secret_name}}" } } });
    expect(parseMcpJson('{"command":"npx","args":["-y","x"]}')).toEqual({ ok: true, name: undefined, server: { command: "npx", args: ["-y", "x"] } });
    expect(parseMcpJson('{"mcpServers":{"pw":{"command":"npx"}}}')).toMatchObject({ ok: true, name: "pw" });
  });

  it("rejects invalid configs with a reason", () => {
    expect(parseMcpJson("")).toMatchObject({ ok: false });
    expect(parseMcpJson("{")).toMatchObject({ ok: false });
    expect(parseMcpJson('{"a":{"url":"x"}}')).toMatchObject({ ok: false, error: "x is not a URL." });
    expect(parseMcpJson('{"url":"https://a.b","command":"x"}')).toMatchObject({ ok: false });
    expect(parseMcpJson('{"url":"https://a.b","env":{"A":"1"}}')).toMatchObject({ ok: false });
    expect(parseMcpJson('{"a":{"url":"https://a.b"},"b":{"url":"https://a.b"}}')).toMatchObject({ ok: false, error: "Add exactly one MCP server." });
  });

  it("finds secret placeholders", () => {
    expect(secretRefs({ command: "x", args: ["{{A}}"], env: { B: "pre {{ B_2 }} post", C: "{{A}}" } })).toEqual(["A", "B_2"]);
  });

  it("round-trips templates and their variants", () => {
    for (const t of MCP_TEMPLATES.flatMap((t) => (t.variants ?? [undefined]).map((v) => pickVariant(t, v?.id)))) {
      const values = Object.fromEntries((t.fields ?? []).map((f) => [f.key, f.kind === "url" ? "https://x.example.com" : "v"]));
      const server = JSON.parse(JSON.stringify(fillTemplate(t.server, t.fields ?? [], values))) as typeof t.server;
      const r = parseMcpJson(toMcpJson(t.id, server));
      expect(r).toEqual({ ok: true, name: t.id, server });
    }
  });

  it("fills a template's plain fields in and keeps its secret fields as references (#44)", () => {
    const signoz = MCP_TEMPLATES.find((t) => t.id === "signoz")!;
    expect(fieldsError(signoz.fields!, {})).toBe("Enter signoz url.");
    expect(fieldsError(signoz.fields!, { SIGNOZ_URL: "signoz.acme.test", SIGNOZ_API_KEY: "k" })).toBe("SigNoz URL must start with https://");
    expect(fieldsError(signoz.fields!, { SIGNOZ_URL: "https://signoz.acme.test", SIGNOZ_API_KEY: "k" })).toBeUndefined();
    // A secret that already exists may stay empty.
    expect(fieldsError(signoz.fields!, { SIGNOZ_URL: "https://signoz.acme.test" }, [])).toBeUndefined();
    expect(fillTemplate(signoz.server, signoz.fields!, { SIGNOZ_URL: " https://signoz.acme.test " })).toMatchObject({
      url: "https://mcp.us.signoz.cloud/mcp",
      headers: { "SIGNOZ-API-KEY": "{{SIGNOZ_API_KEY}}", "X-SigNoz-URL": "https://signoz.acme.test" },
    });
  });

  it("offers SigNoz Cloud and a self-hosted local server (#51)", () => {
    const signoz = MCP_TEMPLATES.find((t) => t.id === "signoz")!;
    expect(signoz.variants?.map((v) => v.label)).toEqual(["SigNoz Cloud", "Self-hosted"]);
    // The template itself is its first variant, so code that ignores variants still gets Cloud.
    expect(pickVariant(signoz)).toMatchObject({ server: signoz.server, mode: "managed" });
    const self = pickVariant(signoz, "self-hosted");
    expect(self).toMatchObject({ id: "signoz", name: "SigNoz", mode: "direct" });
    expect(self.fields?.map((f) => f.key)).toEqual(["SIGNOZ_URL", "SIGNOZ_API_KEY"]);
    expect(fillTemplate(self.server, self.fields!, { SIGNOZ_URL: "https://signoz.acme.test" })).toMatchObject({
      command: "signoz-mcp-server",
      env: { SIGNOZ_URL: "https://signoz.acme.test", SIGNOZ_API_KEY: "{{SIGNOZ_API_KEY}}" },
    });
    expect(pickVariant(signoz, "nope")).toEqual(pickVariant(signoz));
  });

  it("slugifies display names", () => {
    expect(toMcpName("My Sentry!")).toBe("my-sentry");
    expect(toMcpName("--x_y--")).toBe("x_y");
  });
});
