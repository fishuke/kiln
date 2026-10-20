import { describe, expect, it } from "vitest";
import { CUSTOM_SUGGESTION, MCP_TEMPLATES, parseMcpJson, secretRefs, toMcpJson, toMcpName } from "./mcp-config";

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

  it("round-trips templates", () => {
    for (const t of MCP_TEMPLATES) {
      const r = parseMcpJson(toMcpJson(t.id, t.server));
      expect(r).toEqual({ ok: true, name: t.id, server: t.server });
    }
  });

  it("slugifies display names", () => {
    expect(toMcpName("My Sentry!")).toBe("my-sentry");
    expect(toMcpName("--x_y--")).toBe("x_y");
  });
});
