import { createTestKiln } from "@kiln/engine";
import type { SandboxAddress } from "@kiln/sandbox";
import { Hono } from "hono";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import {
  previewConfig,
  previewMiddleware,
  previewPeerGuard,
  previewTarget,
  previewUpgrade,
  previewUrlFor,
  refusePreviewPeers,
  setPreviewResolver,
  type PreviewResolver,
} from "./routes/studio-preview";

const DOMAIN = "preview.kiln.test";
const ID = "sc_0123456789abcdef0123456789abcdef";
const LABEL = "sc-0123456789abcdef0123456789abcdef";
const HOST = `${LABEL}.${DOMAIN}`;
const config = previewConfig({ KILN_STUDIO_PREVIEW_DOMAIN: DOMAIN })!;

const SUFFIX = "-preview.inofy.co";
const SUFFIX_HOST = `${LABEL}${SUFFIX}`;
const suffixEnv = { KILN_STUDIO_PREVIEW_DOMAIN: "inofy.co", KILN_STUDIO_PREVIEW_SUFFIX: SUFFIX };
const suffixConfig = previewConfig(suffixEnv)!;

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(server: Server): Promise<SandboxAddress> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { host: "127.0.0.1", port: (server.address() as AddressInfo).port };
}

type Seen = { method?: string; url?: string; headers: IncomingHttpHeaders; body: string };

/** A dev server stand-in that records the request and answers with a cookie and a custom header. */
async function upstream() {
  const seen: Seen = { headers: {}, body: "" };
  const address = await listen(
    createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        Object.assign(seen, { method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(201, { "content-type": "text/plain", "x-app": "next", "set-cookie": ["kiln_session=evil; Domain=kiln.test", "a=1"] });
        res.end(`hello ${req.url}`);
      });
    }),
  );
  return { seen, address };
}

const resolver = (map: Record<string, SandboxAddress>): PreviewResolver => ({ resolvePreview: async (t) => map[t] });

function proxyApp(r: PreviewResolver | undefined) {
  const app = new Hono();
  app.use(
    "*",
    previewMiddleware(config, () => r),
  );
  app.all("*", (c) => c.text("kiln", 200));
  return app;
}

describe("preview URLs and hosts", () => {
  it("links straight to the sandbox address when no preview domain is set", () => {
    expect(previewConfig({})).toBeUndefined();
    expect(previewUrlFor({})(ID, { host: "127.0.0.1", port: 4101 })).toBe("http://127.0.0.1:4101");
  });

  it("gives each target its own https origin under the preview domain", () => {
    expect(previewUrlFor({ KILN_STUDIO_PREVIEW_DOMAIN: DOMAIN })(ID, { host: "10.0.0.5", port: 4101 })).toBe(`https://${HOST}`);
  });

  it("uses http for a .localhost preview domain with a port", () => {
    expect(previewUrlFor({ KILN_STUDIO_PREVIEW_DOMAIN: "preview.localhost:4000" })(ID, { host: "127.0.0.1", port: 4101 })).toBe(
      `http://${LABEL}.preview.localhost:4000`,
    );
  });

  it("maps a preview host back to its target, ignoring case and port", () => {
    expect(previewTarget(config, `${HOST.toUpperCase()}:443`)).toBe(ID);
  });

  it("leaves other hosts alone and rejects nested or malformed labels", () => {
    expect(previewTarget(config, "kiln.test")).toBeUndefined();
    expect(previewTarget(config, DOMAIN)).toBeUndefined();
    expect(previewTarget(config, `evil.${HOST}`)).toBeNull();
    expect(previewTarget(config, `sc_abc.${DOMAIN}`)).toBeNull();
    expect(previewTarget(config, `nodash.${DOMAIN}`)).toBeNull();
  });

  describe("with KILN_STUDIO_PREVIEW_SUFFIX set", () => {
    it("reads the suffix into the config and keeps the domain's scheme", () => {
      expect(suffixConfig).toMatchObject({ domain: "inofy.co", suffix: SUFFIX, scheme: "https" });
      expect(previewConfig({ KILN_STUDIO_PREVIEW_DOMAIN: DOMAIN })!.suffix).toBeUndefined();
    });

    it("builds preview URLs as https://<label><suffix>", () => {
      expect(previewUrlFor(suffixEnv)(ID, { host: "10.0.0.5", port: 4101 })).toBe(`https://${SUFFIX_HOST}`);
    });

    it("maps a suffix host back to its target, ignoring case and port", () => {
      expect(previewTarget(suffixConfig, `${SUFFIX_HOST.toUpperCase()}:443`)).toBe(ID);
    });

    it("returns undefined for the API and app hosts that share the base domain", () => {
      expect(previewTarget(suffixConfig, "kiln-api.inofy.co")).toBeUndefined();
      expect(previewTarget(suffixConfig, "kiln.inofy.co")).toBeUndefined();
      expect(previewTarget(suffixConfig, "inofy.co")).toBeUndefined();
    });

    it("returns null for a host that ends in the suffix but has a malformed label", () => {
      expect(previewTarget(suffixConfig, `x${SUFFIX}`)).toBeNull();
      expect(previewTarget(suffixConfig, `sc_abc${SUFFIX}`)).toBeNull();
      expect(previewTarget(suffixConfig, `evil.${SUFFIX_HOST}`)).toBeNull();
    });
  });
});

describe("preview proxy (HTTP)", () => {
  it("forwards method, path, query and body to the sandbox and streams the answer back", async () => {
    const { seen, address } = await upstream();
    const res = await proxyApp(resolver({ [ID]: address })).fetch(
      new Request(`http://${HOST}/api/items?x=1`, { method: "POST", body: "payload", headers: { "content-type": "text/plain", "x-custom": "yes" } }),
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("hello /api/items?x=1");
    expect(res.headers.get("x-app")).toBe("next");
    expect(seen).toMatchObject({ method: "POST", url: "/api/items?x=1", body: "payload" });
    expect(seen.headers).toMatchObject({ host: HOST, "x-custom": "yes", "x-forwarded-host": HOST, "x-forwarded-proto": "https" });
  });

  it("never forwards cookies, authorization or Kiln headers to the sandbox", async () => {
    const { seen, address } = await upstream();
    await proxyApp(resolver({ [ID]: address })).fetch(
      new Request(`http://${HOST}/`, {
        headers: { cookie: "kiln_session=secret", authorization: "Bearer kiln_tok", "proxy-authorization": "Basic x", "x-kiln-team": "acme" },
      }),
    );
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers["proxy-authorization"]).toBeUndefined();
    expect(seen.headers["x-kiln-team"]).toBeUndefined();
  });

  it("drops set-cookie from the sandbox's answer", async () => {
    const { address } = await upstream();
    const res = await proxyApp(resolver({ [ID]: address })).fetch(new Request(`http://${HOST}/`));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers the same 404 for an unknown, malformed or unresolvable target", async () => {
    const { address } = await upstream();
    const app = proxyApp(resolver({ [ID]: address }));
    const unknown = await app.fetch(new Request(`http://sc-ffffffffffffffffffffffffffffffff.${DOMAIN}/`));
    const malformed = await app.fetch(new Request(`http://a.b.${DOMAIN}/`));
    const noStudio = await proxyApp(undefined).fetch(new Request(`http://${HOST}/`));
    for (const res of [unknown, malformed, noStudio]) {
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("preview not found");
    }
  });

  it("answers 502 when the dev server is not listening", async () => {
    const closed = await listen(createServer());
    await new Promise((r) => servers.pop()!.close(r));
    const res = await proxyApp(resolver({ [ID]: closed })).fetch(new Request(`http://${HOST}/`));
    expect(res.status).toBe(502);
  });

  it("passes every other host to Kiln", async () => {
    const res = await proxyApp(resolver({})).fetch(new Request("http://kiln.test/api/v1/health"));
    expect(await res.text()).toBe("kiln");
  });

  it("is registered on the API before auth when the preview domain is set", async () => {
    vi.stubEnv("KILN_STUDIO_PREVIEW_DOMAIN", DOMAIN);
    const { seen, address } = await upstream();
    const { kiln } = createTestKiln({ preview: false });
    const app = createApp(kiln);
    // After createApp, which registers the real Studio as the resolver.
    setPreviewResolver(kiln, resolver({ [ID]: address }));
    const res = await app.fetch(new Request(`http://${HOST}/api/v1/me`, { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(201);
    expect(seen.url).toBe("/api/v1/me");
    expect((await app.fetch(new Request("http://kiln.test/api/v1/me"))).status).toBe(401);
  });
});

describe("preview network guard", () => {
  it("matches addresses in the preview subnet, IPv4-mapped ones too", () => {
    const fromPreview = previewPeerGuard("172.30.250.0/24")!;
    expect(fromPreview("172.30.250.9")).toBe(true);
    expect(fromPreview("::ffff:172.30.250.9")).toBe(true);
    expect(fromPreview("172.30.251.9")).toBe(false);
    expect(fromPreview(undefined)).toBe(false);
  });

  it("is off without a subnet and refuses a malformed one", () => {
    expect(previewPeerGuard(undefined)).toBeUndefined();
    expect(() => previewPeerGuard("kiln-preview")).toThrow(/KILN_PREVIEW_SUBNET/);
  });

  it("closes connections the API receives from the preview subnet, so sandboxes can't call it", async () => {
    const server = createServer((_req, res) => res.end("kiln"));
    refusePreviewPeers(server, previewPeerGuard("127.0.0.0/8")!);
    const address = await listen(server);
    await expect(fetch(`http://${address.host}:${address.port}/`)).rejects.toThrow();
  });
});

describe("preview proxy (WebSocket upgrade)", () => {
  /** An HMR stand-in: answers the upgrade with a cookie, then echoes frames. */
  async function wsUpstream() {
    const seen: { headers: IncomingHttpHeaders; url?: string } = { headers: {} };
    const server = createServer((_req, res) => res.end());
    server.on("upgrade", (req, socket) => {
      Object.assign(seen, { headers: req.headers, url: req.url });
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSet-Cookie: kiln_session=evil\r\nX-Hmr: 1\r\n\r\n");
      socket.on("data", (d) => socket.write(`echo:${d}`));
      socket.on("end", () => socket.end());
    });
    return { seen, address: await listen(server) };
  }

  async function front(r: PreviewResolver) {
    const server = createServer((_req, res) => res.end("kiln"));
    const upgrade = previewUpgrade(config, () => r);
    server.on("upgrade", (req, socket, head) => {
      if (!upgrade(req, socket, head)) socket.destroy();
    });
    return listen(server);
  }

  function connect(address: SandboxAddress, host: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; send?: (s: string) => Promise<string> }>((resolve, reject) => {
      const req = request({ ...address, path: "/_next/webpack-hmr?page=/", headers: { host, connection: "Upgrade", upgrade: "websocket", ...headers } });
      req.on("upgrade", (res, socket) =>
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          send: (s) =>
            new Promise((ok) => {
              socket.once("data", (d) => {
                ok(String(d));
                socket.destroy();
              });
              socket.write(s);
            }),
        }),
      );
      req.on("response", (res) => resolve({ status: res.statusCode!, headers: res.headers }));
      req.on("error", reject);
      req.end();
    });
  }

  it("tunnels a hot-reload websocket to the sandbox without Kiln credentials", async () => {
    const { seen, address } = await wsUpstream();
    const kiln = await front(resolver({ [ID]: address }));
    const ws = await connect(kiln, HOST, { cookie: "kiln_session=secret", authorization: "Bearer kiln_tok", "x-kiln-team": "acme" });
    expect(ws.status).toBe(101);
    expect(ws.headers["x-hmr"]).toBe("1");
    expect(ws.headers["set-cookie"]).toBeUndefined();
    expect(await ws.send!("ping")).toBe("echo:ping");
    expect(seen.url).toBe("/_next/webpack-hmr?page=/");
    expect(seen.headers).toMatchObject({ host: HOST, upgrade: "websocket" });
    expect(seen.headers.cookie).toBeUndefined();
    expect(seen.headers.authorization).toBeUndefined();
    expect(seen.headers["x-kiln-team"]).toBeUndefined();
  });

  it("answers 404 to an upgrade for an unknown target", async () => {
    const kiln = await front(resolver({}));
    expect((await connect(kiln, HOST)).status).toBe(404);
  });

  it("ignores upgrades for other hosts", () => {
    const upgrade = previewUpgrade(config, () => resolver({}));
    expect(upgrade({ headers: { host: "kiln.test" } } as never, {} as never, Buffer.alloc(0))).toBe(false);
  });
});
