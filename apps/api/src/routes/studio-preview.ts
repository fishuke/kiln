import type { SandboxAddress } from "@kiln/sandbox";
import type { MiddlewareHandler } from "hono";
import { request, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";
import { Readable, type Duplex } from "node:stream";
import type { RouteContext } from "../app";

/**
 * Studio live previews (ADR-012, docs/specs/studio.md): a dev server inside a sandbox, served on its
 * own origin `<label>.<KILN_STUDIO_PREVIEW_DOMAIN>` so code an agent wrote never runs on Kiln's origin.
 * The target id (128 random bits) is the only credential. Kiln cookies and auth headers never reach
 * the sandbox, and the sandbox can't set cookies through the proxy.
 */

/** What the proxy needs from Studio; `Studio` satisfies it. */
export type PreviewResolver = { resolvePreview(target: string): Promise<SandboxAddress | undefined> };
export type PreviewConfig = { domain: string; port?: string; scheme: "http" | "https" };

const resolvers = new WeakMap<object, PreviewResolver>();
/** routes/studio.ts calls this when it builds the Studio service for a `Kiln`. */
export function setPreviewResolver(kiln: object, resolver: PreviewResolver) {
  resolvers.set(kiln, resolver);
}
export function getPreviewResolver(kiln: object): PreviewResolver | undefined {
  return resolvers.get(kiln);
}

/** `KILN_STUDIO_PREVIEW_DOMAIN`, e.g. `preview.kiln.example.com`, or `preview.localhost:4000` (http) for local development. */
export function previewConfig(env: Record<string, string | undefined> = process.env): PreviewConfig | undefined {
  const raw = env.KILN_STUDIO_PREVIEW_DOMAIN?.trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
  if (!raw) return undefined;
  const [domain, port] = raw.split(":") as [string, string | undefined];
  const local = domain === "localhost" || domain.endsWith(".localhost");
  return { domain, port, scheme: local ? "http" : "https" };
}

/** The `previewUrl` option for `Studio`: a preview origin when a domain is set, else the sandbox address itself. */
export function previewUrlFor(env: Record<string, string | undefined> = process.env): (target: string, address: SandboxAddress) => string {
  const config = previewConfig(env);
  if (!config) return (_target, a) => `http://${a.host}:${a.port}`;
  return (target) => `${config.scheme}://${target.replace("_", "-").toLowerCase()}.${config.domain}${config.port ? `:${config.port}` : ""}`;
}

// "sc-<lowercase letters and digits>": a DNS label (no "_", at most 63 characters) for the id "sc_<…>".
const LABEL = /^([a-z]{1,8})-([a-z0-9]{1,54})$/;

/** The target id for a preview host; `undefined` for any other host, `null` for a preview host with a malformed label. */
export function previewTarget(config: PreviewConfig, host: string | undefined): string | null | undefined {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = `.${config.domain}`;
  if (!name.endsWith(suffix)) return undefined;
  const m = LABEL.exec(name.slice(0, -suffix.length));
  return m ? `${m[1]}_${m[2]}` : null;
}

/** Every unknown, stopped or malformed target gets this same answer, so a probe learns nothing. */
const NOT_FOUND = "preview not found";

// Hop-by-hop headers (RFC 9110 7.6.1) and credentials, dropped on the way in.
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
const credential = (name: string) =>
  name === "cookie" ||
  name === "authorization" ||
  name.startsWith("proxy-") ||
  name.startsWith("x-kiln-") ||
  name === "x-forwarded-host" ||
  name === "x-forwarded-proto";

function forwardHeaders(pairs: Iterable<[string, string]>, host: string, config: PreviewConfig, keepUpgrade = false): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of pairs) {
    const name = k.toLowerCase();
    if (credential(name) || name === "host") continue;
    if (HOP.has(name) && !(keepUpgrade && (name === "connection" || name === "upgrade"))) continue;
    out.push([name, v]);
  }
  out.push(["host", host], ["x-forwarded-host", host], ["x-forwarded-proto", config.scheme]);
  return out;
}

async function resolve(target: string | null, resolver: PreviewResolver | undefined): Promise<SandboxAddress | undefined> {
  if (!target || !resolver) return undefined;
  // The Store looks the id up by key; nothing here compares it piecemeal or lists ids.
  return resolver.resolvePreview(target).catch(() => undefined);
}

function proxyHttp(req: Request, address: SandboxAddress, host: string, config: PreviewConfig): Promise<Response> {
  const url = new URL(req.url);
  const headers: OutgoingHttpHeaders = {};
  for (const [k, v] of forwardHeaders(req.headers, host, config)) headers[k] = v;
  return new Promise((done) => {
    const upstream = request(
      { host: address.host, port: address.port, method: req.method, path: url.pathname + url.search, headers },
      (res: IncomingMessage) => {
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined || HOP.has(k) || k === "set-cookie") continue;
          for (const value of Array.isArray(v) ? v : [v]) out.append(k, value);
        }
        const status = res.statusCode ?? 502;
        const empty = req.method === "HEAD" || status === 204 || status === 304;
        if (empty) res.resume();
        done(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: out }));
      },
    );
    upstream.on("error", () => done(new Response("preview is not running", { status: 502 })));
    req.signal?.addEventListener("abort", () => upstream.destroy());
    if (req.body) Readable.fromWeb(req.body as never).pipe(upstream);
    else upstream.end();
  });
}

/** Hono middleware: proxies preview hosts, passes every other host to `next()`. */
export function previewMiddleware(config: PreviewConfig, resolver: () => PreviewResolver | undefined): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    const target = previewTarget(config, host);
    if (target === undefined) return next();
    const address = await resolve(target, resolver());
    if (!address) return c.text(NOT_FOUND, 404);
    return proxyHttp(c.req.raw, address, host.toLowerCase(), config);
  };
}

function refuse(socket: Duplex, status: number, reason: string) {
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(NOT_FOUND)}\r\n\r\n${NOT_FOUND}`,
  );
}

/** Drops `Set-Cookie` lines from the upstream's response head, then pipes the rest through untouched. */
function filterResponseHead(from: Duplex, to: Duplex) {
  let buffered = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf("\r\n\r\n");
    if (end < 0) {
      if (buffered.length > 64 * 1024) from.destroy();
      return;
    }
    from.off("data", onData);
    const head = buffered
      .subarray(0, end)
      .toString("latin1")
      .split("\r\n")
      .filter((line) => !/^set-cookie2?\s*:/i.test(line))
      .join("\r\n");
    to.write(Buffer.concat([Buffer.from(`${head}\r\n\r\n`, "latin1"), buffered.subarray(end + 4)]));
    from.pipe(to);
  };
  from.on("data", onData);
}

/**
 * Node `upgrade` listener for hot reload (Next.js HMR) on preview hosts. Returns false for any other
 * host, so the caller can handle or refuse it.
 */
export function previewUpgrade(config: PreviewConfig, resolver: () => PreviewResolver | undefined) {
  return (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const host = req.headers.host ?? "";
    const target = previewTarget(config, host);
    if (target === undefined) return false;
    socket.on("error", () => socket.destroy());
    void resolve(target, resolver()).then((address) => {
      if (!address) return refuse(socket, 404, "Not Found");
      const upstream = connect(address.port, address.host);
      upstream.on("error", () => (upstream.readyState === "opening" ? refuse(socket, 502, "Bad Gateway") : socket.destroy()));
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
      upstream.once("connect", () => {
        const pairs: [string, string][] = [];
        for (let i = 0; i < req.rawHeaders.length; i += 2) pairs.push([req.rawHeaders[i]!, req.rawHeaders[i + 1]!]);
        const lines = forwardHeaders(pairs, host.toLowerCase(), config, true).map(([k, v]) => `${k}: ${v}`);
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
        if (head.length) upstream.write(head);
        filterResponseHead(upstream, socket);
        socket.pipe(upstream);
      });
    });
    return true;
  };
}

/**
 * `KILN_PREVIEW_SUBNET` (the Docker preview network's subnet, e.g. `172.30.250.0/24`): true for a peer
 * on it. The API only opens connections into that network; the sandboxes on it must not call the API.
 */
export function previewPeerGuard(subnet: string | undefined): ((address: string | undefined) => boolean) | undefined {
  if (!subnet?.trim()) return undefined;
  const [ip, bits] = subnet.trim().split("/");
  const prefix = Number(bits);
  if (!ip || isIP(ip) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    throw new Error(`KILN_PREVIEW_SUBNET must be an IPv4 CIDR such as 172.30.250.0/24, got "${subnet}"`);
  const list = new BlockList();
  list.addSubnet(ip, prefix, "ipv4");
  return (address) => {
    const v4 = address?.replace(/^::ffff:/i, "");
    return Boolean(v4 && isIP(v4) === 4 && list.check(v4, "ipv4"));
  };
}

/** Closes every connection a server accepts from the preview network. */
export function refusePreviewPeers(
  server: { on(event: "connection", listener: (socket: Socket) => void): unknown },
  fromPreview: (address: string | undefined) => boolean,
) {
  server.on("connection", (socket) => {
    if (fromPreview(socket.remoteAddress)) socket.destroy();
  });
}

/** A `PUBLIC_MODULES` entry: preview hosts never reach Kiln's auth or routes. Off without a preview domain. */
export function registerStudioPreview(ctx: RouteContext) {
  const config = previewConfig();
  if (!config) return;
  ctx.app.use(
    "*",
    previewMiddleware(config, () => getPreviewResolver(ctx.kiln)),
  );
}
