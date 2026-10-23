import { Agent, fetch } from "undici";

/** Long-lived event streams sit idle between events; undici's default body timeout (300 s) would cut them off. */
const agents = new Map<number, Agent>();
const agentFor = (bodyTimeout: number) => {
  let a = agents.get(bodyTimeout);
  if (!a) agents.set(bodyTimeout, (a = new Agent({ bodyTimeout })));
  return a;
};

/**
 * Proxies a server-sent event stream from `url` (GET with `headers`) to the browser. The upstream request has no
 * body timeout (`bodyTimeout` 0) and ends when `signal` aborts, i.e. when the browser disconnects.
 * Answers the upstream status with no body when it fails, and 502 (logged) when it can't be reached.
 * `bodyTimeout` is only for tests, which show what a body timeout does to an idle stream.
 */
export async function proxyEventStream(url: string, opts: { headers: Record<string, string>; signal: AbortSignal; bodyTimeout?: number }): Promise<Response> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, { headers: opts.headers, signal: opts.signal, dispatcher: agentFor(opts.bodyTimeout ?? 0) });
  } catch (err) {
    if (!opts.signal.aborted) console.error(`event stream ${url} failed`, err);
    return new Response(null, { status: 502 });
  }
  if (!res.ok || !res.body) return new Response(null, { status: res.status || 502 });
  return new Response(res.body as ReadableStream<Uint8Array>, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
