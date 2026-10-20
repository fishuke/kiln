import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeHarness } from "@kiln/harness";
import { FakeS3Server, MemoryObjectStore } from "@kiln/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestKiln } from "../testing";

describe("per-team data storage", () => {
  const s3 = new FakeS3Server();
  beforeAll(() => s3.start());
  afterAll(() => s3.stop());

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "kiln-storage-"));
    const base = new MemoryObjectStore();
    const harness = new FakeHarness(async (ctx) => {
      await ctx.opts.sandbox.writeFile(`${ctx.opts.cwd}/.kiln/artifacts/after.png`, "png-bytes");
      ctx.emit({ type: "message", text: "working" });
      return { summary: "done" };
    });
    const t = createTestKiln({ harness: () => harness, objects: base, storageRoot: root });
    const team = t.kiln.teams.ensureDefaultTeam();
    return { ...t, root, base, team };
  }

  it("routes artifacts to an S3-compatible bucket and transcripts to a local folder", async () => {
    const { kiln, root, base, team } = setup();
    kiln.vault.set({ scope: "team", owner: team.id, name: "S3_KEY_ID", value: s3.credentials.accessKeyId }, "a");
    kiln.vault.set({ scope: "team", owner: team.id, name: "S3_SECRET", value: s3.credentials.secretAccessKey }, "a");
    kiln.teams.updateSettings(
      team.id,
      {
        storage: {
          artifacts: { kind: "s3", bucket: "kiln-artifacts", region: "us-east-1", endpoint: s3.url, prefix: "acme", accessKeyIdSecret: "S3_KEY_ID", secretAccessKeySecret: "S3_SECRET" },
          transcripts: { kind: "local", path: "acme/transcripts" },
          attachments: { kind: "local" },
        },
      },
      "a",
    );
    expect(await kiln.storage.test(team.id, "artifacts")).toEqual({ ok: true });
    const sha = kiln.defs.require("webapp").appliedSha!;
    const run = await kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
    expect(run.artifacts[0]).toMatchObject({ key: `runs/${run.id}/after.png` });
    expect(s3.objects.get(`kiln-artifacts/acme/runs/${run.id}/after.png`)?.body.toString()).toBe("png-bytes");
    expect(await base.list("runs/")).toEqual([]);
    expect(new TextDecoder().decode(await kiln.objects.get(`runs/${run.id}/after.png`))).toBe("png-bytes");
    const transcript = join(root, "acme/transcripts", `transcripts/${run.id}.jsonl`);
    expect(existsSync(transcript)).toBe(true);
    expect(readFileSync(transcript, "utf8")).toContain('"text":"working"');
    expect(kiln.runs.get(run.id)!.transcriptKey).toBe(`transcripts/${run.id}.jsonl`);
    // Changing settings later does not lose what was written before.
    kiln.teams.updateSettings(team.id, { storage: { artifacts: { kind: "local" }, transcripts: { kind: "local" }, attachments: { kind: "local" } } }, "a");
    expect(new TextDecoder().decode(await kiln.objects.get(`runs/${run.id}/after.png`))).toBe("png-bytes");
    expect(await kiln.objects.list(`runs/${run.id}/`)).toEqual([`runs/${run.id}/after.png`]);
  });

  it("attachments under attachments/<team>/ follow the team's attachment storage", async () => {
    const { kiln, root, team, base } = setup();
    kiln.teams.updateSettings(team.id, { storage: { ...kiln.teams.settings(team.id).storage, attachments: { kind: "local", path: "att" } } }, "a");
    const key = kiln.storage.attachmentKey(team.id, "brief notes.txt");
    expect(key).toMatch(new RegExp(`^attachments/${team.id}/att_\\w+/brief_notes.txt$`));
    await kiln.objects.put(key, "make it blue", "text/plain");
    expect(readFileSync(join(root, "att", key), "utf8")).toBe("make it blue");
    expect(await base.get(key)).toBeUndefined();
    await kiln.objects.put("uploads/x.txt", "default store");
    expect(await base.get("uploads/x.txt")).toBeDefined();
  });

  it("local folders stay inside the storage root; broken buckets report why", async () => {
    const { kiln, team } = setup();
    const local = (path: string) => ({ storage: { artifacts: { kind: "local" as const, path }, transcripts: { kind: "local" as const }, attachments: { kind: "local" as const } } });
    expect(() => kiln.teams.updateSettings(team.id, local("../../etc"), "a")).toThrow("inside the server's storage root");
    expect(() => kiln.teams.updateSettings(team.id, local("/etc"), "a")).toThrow("inside the server's storage root");
    kiln.teams.updateSettings(team.id, { storage: { artifacts: { kind: "s3", bucket: "b", region: "us-east-1", endpoint: s3.url, accessKeyIdSecret: "NOPE", secretAccessKeySecret: "NOPE2" }, transcripts: { kind: "local" }, attachments: { kind: "local" } } }, "a");
    expect(await kiln.storage.test(team.id, "artifacts")).toMatchObject({ ok: false, error: expect.stringContaining("no credentials for bucket b") });
  });
});
