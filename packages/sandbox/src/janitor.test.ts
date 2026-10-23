import { describe, expect, it } from "vitest";
import { composeProjectOfSelf, DockerJanitor, parseByteSize } from "./janitor";
import { DiskSpaceLow, DockerSandboxProvider } from "./index";
import { FakeCommandRunner } from "./process";

const now = () => new Date("2026-10-23T12:00:00Z");
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const image = (ID: string, Repository: string, Tag: string, CreatedAt: string, Containers = "0") =>
  JSON.stringify({ ID, Repository, Tag, CreatedAt, Size: "2.5GB", Containers });

/** A host with Kiln's project "abc": a running API, old stopped containers, three runner builds and someone else's things. */
function host() {
  return new FakeCommandRunner((_cmd, args) => {
    const a = args.join(" ");
    if (a.startsWith("system df"))
      return ok(
        '{"Type":"Images","TotalCount":"74","Size":"60.6GB","Reclaimable":"42.8GB (70%)"}\n{"Type":"Build Cache","TotalCount":"361","Size":"23.4GB","Reclaimable":"23.4GB"}\n',
      );
    if (a.includes("label=kiln.sandbox=1"))
      return ok(
        "s1\tkiln-sbx_old\texited\t2026-10-20 09:00:00 +0000 UTC\tkiln-runner-node:local\ns2\tkiln-sbx_new\texited\t2026-10-23 11:00:00 +0000 UTC\tkiln-runner-node:local\n",
      );
    if (a.startsWith("ps -a --filter label=com.docker.compose.project=abc"))
      return ok(
        "c1\tapi-abc-1\trunning\t2026-10-23 10:00:00 +0000 UTC\tabc_api:sha3\nc2\trunner-image-abc-20261020\texited\t2026-10-20 09:00:00 +0000 UTC\tkiln-runner-node:local\n",
      );
    if (a.startsWith("ps -a --format"))
      return ok("c1\tabc_api:sha3\nc2\tkiln-runner-node:local\ns1\tkiln-runner-node:local\ns2\tkiln-runner-node:local\no1\tpostgres:16\n");
    if (a.startsWith("images"))
      return ok(
        [
          image("i3", "abc_api", "sha3", "2026-10-23 09:00:00 +0000 UTC", "1"),
          image("i2", "abc_api", "sha2", "2026-10-22 09:00:00 +0000 UTC"),
          image("i1", "abc_api", "sha1", "2026-10-21 09:00:00 +0000 UTC"),
          image("r2", "kiln-runner-node", "local", "2026-10-23 09:00:00 +0000 UTC", "2"),
          image("d1", "<none>", "<none>", "2026-10-20 09:00:00 +0000 UTC"),
          image("d2", "<none>", "<none>", "2026-10-23 11:30:00 +0000 UTC"),
        ].join("\n"),
      );
    if (a.startsWith("volume ls")) return ok("abc_kiln-data\nold_kiln-data\n");
    if (a.includes("volume=abc_kiln-data")) return ok("c1\n");
    return ok();
  });
}

describe("docker janitor", () => {
  it("plans to remove only Kiln's stopped containers and superseded images, never volumes", async () => {
    const plan = await new DockerJanitor(host(), { project: "abc" }, now).plan();
    expect(plan.containers.map((c) => c.name)).toEqual(["kiln-sbx_old", "runner-image-abc-20261020"]);
    // i3 runs the API, i2 is the newest kept for rollback, d2 is too young; r2 is in use.
    expect(plan.images.map((i) => i.name)).toEqual(["abc_api:sha1", "d1"]);
    expect(plan.images[0]!.sizeBytes).toBe(2.5e9);
    expect(plan.volumes).toEqual([
      { name: "abc_kiln-data", inUse: true },
      { name: "old_kiln-data", inUse: false },
    ]);
  });

  it("without a project, cleans sandboxes only", async () => {
    const fake = host();
    const plan = await new DockerJanitor(fake, {}, now).plan();
    expect(plan.containers.map((c) => c.name)).toEqual(["kiln-sbx_old"]);
    expect(plan.images).toEqual([]);
    expect(fake.calls.some((c) => c.args[0] === "images")).toBe(false);
  });

  it("removes the plan, prunes old build cache and never removes a volume", async () => {
    const fake = host();
    const run = await new DockerJanitor(fake, { project: "abc" }, now).run();
    const cmds = fake.calls.map((c) => c.args.join(" "));
    expect(cmds).toContain("rm -f -v s1");
    expect(cmds).toContain("rmi i1");
    expect(cmds).toContain("builder prune -f --filter until=168h --keep-storage 10737418240");
    expect(cmds.some((c) => c.startsWith("volume rm") || c.includes("prune -a") || c.startsWith("system prune"))).toBe(false);
    expect(run.removed).toEqual({ containers: ["kiln-sbx_old", "runner-image-abc-20261020"], images: ["abc_api:sha1", "d1"] });
    expect(run.before[0]).toEqual({ type: "Images", count: 74, sizeBytes: 60.6e9, reclaimableBytes: 42.8e9 });
  });

  it("finds its Compose project from its own container", async () => {
    const fake = new FakeCommandRunner(() => ok("abc\n"));
    expect(await composeProjectOfSelf(fake, {}, "c1")).toBe("abc");
    expect(await composeProjectOfSelf(fake, { KILN_COMPOSE_PROJECT: "xyz" }, "c1")).toBe("xyz");
    expect(await composeProjectOfSelf(new FakeCommandRunner(() => ok("<no value>\n")), {}, "c1")).toBeUndefined();
  });

  it("parses Docker's sizes", () => {
    expect(parseByteSize("42.8GB (70%)")).toBe(42.8e9);
    expect(parseByteSize("256MiB")).toBe(256 * 1024 ** 2);
    expect(parseByteSize("0B")).toBe(0);
  });

  it("the disk guard refuses a sandbox before anything starts", async () => {
    const fake = new FakeCommandRunner(() => ok());
    const provider = new DockerSandboxProvider(fake, {
      diskGuard: async () => {
        throw new DiskSpaceLow(5e9, 20e9);
      },
    });
    await expect(provider.create({ runner: { image: "kiln-runner-node:local" } as never, repos: [] })).rejects.toThrow("5 GB free, Kiln needs 20 GB");
    expect(fake.calls).toEqual([]);
  });
});
