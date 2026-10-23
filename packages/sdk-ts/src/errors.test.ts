import { describe, expect, it } from "vitest";
import { KilnApiError, KilnClient } from "./index";

const answering = (res: Response) => new KilnClient({ baseUrl: "http://kiln.test", fetch: (async () => res) as typeof fetch });

describe("KilnApiError", () => {
  it("carries the trace id from the error body", async () => {
    const client = answering(
      Response.json({ error: "the app failed to start", code: "unavailable", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" }, { status: 503 }),
    );
    const err = await client.studioApps().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KilnApiError);
    expect(err).toMatchObject({ status: 503, message: "the app failed to start", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" });
  });

  it("falls back to the x-trace-id header", async () => {
    const client = answering(new Response("upstream failed", { status: 502, headers: { "x-trace-id": "0af7651916cd43dd8448eb211c80319c" } }));
    await expect(client.studioApps()).rejects.toMatchObject({ status: 502, traceId: "0af7651916cd43dd8448eb211c80319c" });
  });

  it("has no trace id when the API sent none", async () => {
    const client = answering(Response.json({ error: "unknown app sa_1" }, { status: 404 }));
    const err = (await client.studioApp("sa_1").catch((e: unknown) => e)) as KilnApiError;
    expect(err.traceId).toBeUndefined();
  });
});
