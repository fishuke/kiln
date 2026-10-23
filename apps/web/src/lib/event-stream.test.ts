import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { proxyEventStream } from "./event-stream";

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? (server.closeAllConnections(), server.close(() => r())) : r())));

/** An SSE server that sends `first`, stays idle for `idleMs`, then sends `second`; `closed` resolves when the client goes away. */
async function sse(idleMs: number) {
  let closed!: () => void;
  const gone = new Promise<void>((r) => (closed = r));
  server = createServer((req, res: ServerResponse) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("event: chat\ndata: first\n\n");
    const timer = setTimeout(() => res.write("event: chat\ndata: second\n\n"), idleMs);
    req.on("close", () => (clearTimeout(timer), closed()));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`, gone };
}

async function readUntil(res: Response, text: string, ms = 3000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + ms;
  while (!seen.includes(text) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  reader.releaseLock();
  return seen;
}

describe("proxyEventStream", () => {
  it("keeps an idle stream open: no body timeout", async () => {
    const { url } = await sse(400);
    const res = await proxyEventStream(url, { headers: {}, signal: new AbortController().signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await readUntil(res, "second")).toContain("data: second");
  });

  it("is what a body timeout would cut off", async () => {
    // undici checks body timeouts on a coarse timer, so the idle gap is well past the timeout.
    const { url } = await sse(2500);
    const res = await proxyEventStream(url, { headers: {}, signal: new AbortController().signal, bodyTimeout: 100 });
    await expect(readUntil(res, "second")).rejects.toThrow();
  });

  it("closes the upstream request when the browser disconnects", async () => {
    const { url, gone } = await sse(10_000);
    const browser = new AbortController();
    const res = await proxyEventStream(url, { headers: {}, signal: browser.signal });
    expect(await readUntil(res, "first")).toContain("data: first");
    browser.abort();
    await expect(Promise.race([gone.then(() => "closed"), new Promise((r) => setTimeout(() => r("open"), 2000))])).resolves.toBe("closed");
  });

  it("answers 502 when the API can't be reached", async () => {
    const res = await proxyEventStream("http://127.0.0.1:1/events", { headers: {}, signal: new AbortController().signal });
    expect(res.status).toBe(502);
  });
});
