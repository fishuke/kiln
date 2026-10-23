import { createTestKiln } from "@kiln/engine";
import { DiskSpaceLow, type JanitorPlan, type JanitorRun } from "@kiln/sandbox";
import { KilnClient } from "@kiln/sdk-ts";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { diskGuard } from "./janitor";

const plan: JanitorPlan = {
  containers: [{ id: "s1", name: "kiln-sbx_old", reason: "exited" }],
  images: [],
  buildCache: { olderThanHours: 168, keepBytes: 10e9 },
  volumes: [{ name: "abc_kiln-data", inUse: true }],
};

function fakeJanitor(reclaim = 5e9) {
  const calls: string[] = [];
  const run = (): JanitorRun => ({
    at: "2026-10-23T12:00:00.000Z",
    removed: { containers: ["kiln-sbx_old"], images: [] },
    failed: [],
    before: [],
    after: [],
    reclaimedBytes: reclaim,
  });
  return {
    calls,
    janitor: {
      diskUsage: async () => [{ type: "Images", count: 3, sizeBytes: 9e9, reclaimableBytes: 6e9 }],
      plan: async () => (calls.push("plan"), plan),
      run: async () => (calls.push("run"), run()),
    },
  };
}

async function setup() {
  const fake = fakeJanitor();
  const t = createTestKiln({ preview: false, serverAdmins: ["olga@acme.test"], janitor: fake.janitor });
  const app = createApp(t.kiln);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => app.fetch(new Request(input as string, init))) as typeof fetch;
  const client = (token?: string) => new KilnClient({ baseUrl: "http://kiln.test", token, fetch: fetchImpl });
  const olga = client((await client().signup({ email: "olga@acme.test", password: "correct horse battery" })).token);
  const inv = await olga.inviteMember("default", "pete@acme.test", "admin");
  const pete = client((await client().signup({ email: "pete@acme.test", password: "correct horse battery", invite: inv.token })).token);
  return { ...t, fake, olga, pete };
}

describe("Docker clean-up from the Server page", () => {
  it("shows the dry run first, runs only when asked, and is off on a schedule until turned on", async () => {
    const { olga, pete, fake, kiln } = await setup();
    await expect(pete.cleanup()).rejects.toMatchObject({ status: 403 });
    const dry = await olga.cleanup();
    expect(dry).toMatchObject({ available: true, scheduled: false, plan });
    expect(fake.calls).toEqual(["plan"]);
    const run = await olga.runCleanup();
    expect(run.reclaimedBytes).toBe(5e9);
    expect((await olga.cleanup()).lastRun).toMatchObject({ by: "olga@acme.test", removed: { containers: ["kiln-sbx_old"] } });
    expect((await olga.setCleanupScheduled(true)).scheduled).toBe(true);
    expect(kiln.auditLog(50).map((a) => a.action)).toEqual(expect.arrayContaining(["server.cleanup", "server.cleanup_scheduled"]));
  });

  it("the disk guard cleans up when space is low and refuses only if it stays low", async () => {
    const { kiln, fake } = await setup();
    let free = 5e9;
    const usage = () => ({ path: "/data", totalBytes: 300e9, freeBytes: free });
    const threshold = { minFreeBytes: 20e9, minFreeRatio: 0.15 };
    await expect(diskGuard(() => kiln, "/data", threshold, usage)()).rejects.toBeInstanceOf(DiskSpaceLow);
    expect(fake.calls).toContain("run");
    free = 100e9;
    fake.calls.length = 0;
    await diskGuard(() => kiln, "/data", threshold, usage)();
    expect(fake.calls).toEqual([]);
  });
});
