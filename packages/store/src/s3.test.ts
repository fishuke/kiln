import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeS3Server, S3ObjectStore, signV4 } from "./index";

describe("SigV4", () => {
  it("matches the AWS documentation example (IAM ListUsers)", () => {
    const h = signV4({
      method: "GET",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      service: "iam",
      region: "us-east-1",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      date: new Date("2015-08-30T12:36:00Z"),
      contentSha256Header: false,
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });
});

describe("S3ObjectStore against a fake S3 server", () => {
  const server = new FakeS3Server();
  let store: S3ObjectStore;
  beforeAll(async () => {
    const url = await server.start();
    store = new S3ObjectStore({ bucket: "kiln", region: "us-east-1", endpoint: url, prefix: "team-a", credentials: server.credentials });
  });
  afterAll(() => server.stop());

  it("puts, gets and lists objects under the prefix", async () => {
    const r = await store.put("runs/run_1/shot one.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(r.url).toBe("s3://kiln/team-a/runs/run_1/shot one.png");
    await store.put("runs/run_1/log.txt", "hello");
    await store.put("runs/run_2/a.txt", "a");
    await store.put("other/x.txt", "x");
    expect(server.objects.get("kiln/team-a/runs/run_1/shot one.png")?.contentType).toBe("image/png");
    expect(await store.get("runs/run_1/shot one.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(await store.get("runs/run_1/log.txt"))).toBe("hello");
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.list("runs/")).toEqual(["runs/run_1/log.txt", "runs/run_1/shot one.png", "runs/run_2/a.txt"]);
  });

  it("fails clearly with the wrong credentials", async () => {
    const bad = new S3ObjectStore({ bucket: "kiln", region: "us-east-1", endpoint: server.url, credentials: { accessKeyId: "AKIDFAKE", secretAccessKey: "wrong" } });
    await expect(bad.put("x", "y")).rejects.toThrow("S3 PUT x failed: 403");
  });

  it("builds AWS virtual-hosted URLs by default", async () => {
    const seen: string[] = [];
    const aws = new S3ObjectStore({ bucket: "b", region: "eu-west-1", credentials: { accessKeyId: "a", secretAccessKey: "s" }, fetch: (async (u: string) => (seen.push(u), new Response(""))) as unknown as typeof fetch });
    await aws.put("k/v.txt", "x");
    expect(seen[0]).toBe("https://b.s3.eu-west-1.amazonaws.com/k/v.txt");
  });
});
