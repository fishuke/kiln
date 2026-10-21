import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpMcpProbe } from "./mcp-probe";

/** A minimal streamable-HTTP MCP server that wants `x-key: right` and answers over SSE. */
let server: Server;
let url = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers["x-key"] !== "right") return void res.writeHead(401).end("unauthorized");
      if (req.url !== "/mcp") return void res.writeHead(404).end();
      const msg = JSON.parse(body) as { id?: number; method: string };
      if (msg.id === undefined) return void res.writeHead(202).end();
      if (msg.method === "tools/list" && req.headers["mcp-session-id"] !== "s1") return void res.writeHead(400).end("no session");
      const result = msg.method === "initialize" ? { protocolVersion: "2025-06-18", serverInfo: { name: "obs" }, capabilities: {} } : { tools: [{ name: "search_logs" }, { name: "get_trace" }] };
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s1" }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe("HttpMcpProbe (#44)", () => {
  const probe = new HttpMcpProbe({ allowLoopback: true, timeoutMs: 2000 });

  it("initializes a session and lists the server's tools", async () => {
    expect(await probe.probe(`${url}/mcp`, { "x-key": "right" })).toEqual({ ok: true, tools: ["search_logs", "get_trace"], server: "obs" });
  });

  it("says what is wrong: credentials, path or reachability", async () => {
    expect(await probe.probe(`${url}/mcp`, { "x-key": "wrong" })).toMatchObject({ ok: false, error: expect.stringContaining("refused the credentials (HTTP 401)") });
    expect(await probe.probe(`${url}/nope`, { "x-key": "right" })).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 404") });
    expect(await probe.probe("http://127.0.0.1:1/mcp", {})).toMatchObject({ ok: false, error: expect.stringContaining("Could not reach 127.0.0.1:1") });
  });

  it("does not test Kiln's own host or the metadata service", async () => {
    const strict = new HttpMcpProbe();
    expect(await strict.probe(`${url}/mcp`, {})).toMatchObject({ ok: false, error: "Kiln does not test servers on 127.0.0.1." });
    expect(await strict.probe("http://169.254.169.254/latest", {})).toMatchObject({ ok: false });
  });
});
