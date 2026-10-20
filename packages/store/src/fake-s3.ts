import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { signV4, type AwsCredentials } from "./s3";

/**
 * A tiny S3-compatible server for tests: path-style PUT, GET and ListObjectsV2 on one region. It
 * checks every request's SigV4 signature and payload hash, like MinIO would.
 */
export class FakeS3Server {
  readonly objects = new Map<string, { body: Buffer; contentType?: string }>();
  readonly requests: { method: string; path: string }[] = [];
  private server?: Server;
  url = "";

  constructor(
    readonly credentials: AwsCredentials = { accessKeyId: "AKIDFAKE", secretAccessKey: "fake-secret" },
    readonly region = "us-east-1",
  ) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const url = `${this.url}${req.url}`;
        const u = new URL(url);
        this.requests.push({ method: req.method!, path: u.pathname });
        const auth = String(req.headers.authorization ?? "");
        const signedNames = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(";") ?? [];
        const payloadHash = createHash("sha256").update(body).digest("hex");
        if (req.headers["x-amz-content-sha256"] !== payloadHash) return this.reply(res, 400, "<Error><Code>XAmzContentSHA256Mismatch</Code></Error>");
        const amzDate = String(req.headers["x-amz-date"] ?? "");
        const date = new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
        const headers = Object.fromEntries(signedNames.filter((n) => !["host", "x-amz-date", "x-amz-content-sha256", "x-amz-security-token"].includes(n)).map((n) => [n, String(req.headers[n] ?? "")]));
        const expected = signV4({ method: req.method!, url, headers, payloadHash, service: "s3", region: this.region, credentials: this.credentials, date }).authorization;
        if (expected !== auth) return this.reply(res, 403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
        const [, bucket, ...rest] = u.pathname.split("/");
        const key = decodeURIComponent(rest.join("/"));
        const full = `${bucket}/${key}`;
        if (req.method === "PUT") {
          this.objects.set(full, { body, contentType: req.headers["content-type"] });
          return this.reply(res, 200, "");
        }
        if (req.method === "GET" && key) {
          const o = this.objects.get(full);
          if (!o) return this.reply(res, 404, "<Error><Code>NoSuchKey</Code></Error>");
          res.writeHead(200, { "content-type": o.contentType ?? "application/octet-stream" });
          return res.end(o.body);
        }
        if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
          const prefix = u.searchParams.get("prefix") ?? "";
          const keys = [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket!.length + 1)).sort();
          const start = Number(u.searchParams.get("continuation-token") ?? 0);
          const page = keys.slice(start, start + 2);
          const more = start + 2 < keys.length;
          const xml = `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`;
          return this.reply(res, 200, xml);
        }
        return this.reply(res, 400, "<Error><Code>NotImplemented</Code></Error>");
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    const addr = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${addr.port}`;
    return this.url;
  }

  private reply(res: import("node:http").ServerResponse, status: number, body: string) {
    res.writeHead(status, { "content-type": "application/xml" });
    res.end(body);
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
