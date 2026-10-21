/** What testing an MCP server found: its tools, or why it could not be used. */
export type McpProbeResult = { ok: true; tools: string[]; server?: string } | { ok: false; error: string };

/** Connects to a URL MCP server the way a harness would and lists its tools. */
export interface McpProbe {
  probe(url: string, headers: Record<string, string>): Promise<McpProbeResult>;
}

/** Answers from a table keyed by URL; unknown URLs are unreachable. */
export class FakeMcpProbe implements McpProbe {
  readonly calls: { url: string; headers: Record<string, string> }[] = [];
  constructor(private readonly results: Record<string, McpProbeResult> = {}) {}
  async probe(url: string, headers: Record<string, string>) {
    this.calls.push({ url, headers });
    return this.results[url] ?? { ok: false as const, error: `Could not reach ${new URL(url).host}.` };
  }
}

// Kiln's own host and the cloud metadata service are never probed; a team admin could otherwise read them.
const BLOCKED = /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1?\]|\[fe80:.*\]|metadata\.google\.internal)$/i;

type Rpc = { id?: number; result?: Record<string, unknown>; error?: { message?: string } };

/** Streamable HTTP: `initialize`, `notifications/initialized`, then `tools/list`. */
export class HttpMcpProbe implements McpProbe {
  constructor(private readonly opts: { timeoutMs?: number; allowLoopback?: boolean; fetch?: typeof fetch } = {}) {}

  async probe(url: string, headers: Record<string, string>): Promise<McpProbeResult> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { ok: false, error: `${url} is not a URL.` };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: `${u.protocol} URLs are not supported.` };
    if (!this.opts.allowLoopback && BLOCKED.test(u.hostname)) return { ok: false, error: `Kiln does not test servers on ${u.hostname}.` };
    const signal = AbortSignal.timeout(this.opts.timeoutMs ?? 10_000);
    const base: Record<string, string> = { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" };
    try {
      const init = await this.call(url, base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kiln", version: "1" } } }, signal);
      if ("error" in init) return { ok: false, error: init.error };
      const next: Record<string, string> = { ...base };
      if (init.session) next["mcp-session-id"] = init.session;
      if (typeof init.rpc.result?.protocolVersion === "string") next["mcp-protocol-version"] = init.rpc.result.protocolVersion;
      await (this.opts.fetch ?? fetch)(url, { method: "POST", headers: next, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal }).then((r) => r.body?.cancel());
      const list = await this.call(url, next, { jsonrpc: "2.0", id: 2, method: "tools/list" }, signal);
      if ("error" in list) return { ok: false, error: list.error };
      const tools = Array.isArray(list.rpc.result?.tools) ? (list.rpc.result.tools as { name?: unknown }[]).map((t) => String(t.name)) : [];
      const info = init.rpc.result?.serverInfo as { name?: unknown } | undefined;
      return { ok: true, tools, server: typeof info?.name === "string" ? info.name : undefined };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      if (e.name === "TimeoutError" || e.name === "AbortError") return { ok: false, error: `${u.host} did not answer within ${Math.round((this.opts.timeoutMs ?? 10_000) / 1000)} s.` };
      return { ok: false, error: `Could not reach ${u.host}: ${e.cause?.code ?? e.cause?.message ?? e.message}.` };
    }
  }

  private async call(url: string, headers: Record<string, string>, body: object, signal: AbortSignal): Promise<{ rpc: Rpc; session?: string } | { error: string }> {
    const res = await (this.opts.fetch ?? fetch)(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) return { error: `The server refused the credentials (HTTP ${res.status}). Check the key.` };
    if (res.status === 404) return { error: `Nothing answers at ${new URL(url).pathname} (HTTP 404). Check the endpoint path.` };
    if (!res.ok) return { error: `The server answered HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}.` };
    const id = (body as { id: number }).id;
    const messages = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
      : [text];
    for (const m of messages) {
      let rpc: Rpc;
      try {
        rpc = JSON.parse(m) as Rpc;
      } catch {
        continue;
      }
      if (rpc.id !== id) continue;
      if (rpc.error) return { error: `The server returned an error: ${rpc.error.message ?? "unknown"}.` };
      return { rpc, session: res.headers.get("mcp-session-id") ?? undefined };
    }
    return { error: "The server's answer is not an MCP response. Check the endpoint path." };
  }
}
