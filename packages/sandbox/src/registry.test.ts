import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DockerSandboxProvider, FakeCommandRunner, imageRegistry, kubernetesManifests, KubernetesSandboxProvider, type SandboxSpec } from "./index";

const auth = { host: "ghcr.io", username: "kiln-bot", password: "ghp_secret" };
const spec: SandboxSpec = { runner: { image: "ghcr.io/acme/runner:1", backend: "docker", setupCommands: [], egress: [] }, repos: [], registryAuth: auth };

describe("private registries", () => {
  it("finds the registry of an image", () => {
    expect(imageRegistry("node:22")).toBe("docker.io");
    expect(imageRegistry("acme/runner")).toBe("docker.io");
    expect(imageRegistry("ghcr.io/acme/runner:1")).toBe("ghcr.io");
    expect(imageRegistry("localhost:5000/runner")).toBe("localhost:5000");
    expect(imageRegistry("123456789012.dkr.ecr.eu-west-1.amazonaws.com/runner:latest")).toBe("123456789012.dkr.ecr.eu-west-1.amazonaws.com");
  });

  it("docker pulls with a temporary DOCKER_CONFIG that is removed afterwards", async () => {
    let config = "";
    let dir = "";
    const fake = new FakeCommandRunner((cmd, args, opts) => {
      if (args[0] === "pull") {
        dir = opts?.env?.DOCKER_CONFIG ?? "";
        config = readFileSync(join(dir, "config.json"), "utf8");
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const sbx = await new DockerSandboxProvider(fake).create(spec);
    await sbx.destroy();
    expect(JSON.parse(config)).toEqual({ auths: { "ghcr.io": { auth: Buffer.from("kiln-bot:ghp_secret").toString("base64") } } });
    expect(existsSync(dir)).toBe(false);
    const run = fake.calls.find((c) => c.args[0] === "run")!;
    expect(JSON.stringify(run)).not.toContain("ghp_secret");
  });

  it("kubernetes gets an imagePullSecret that is deleted with the sandbox", async () => {
    const manifests = kubernetesManifests("kiln-a", "kiln-sandboxes", { ...spec, runner: { ...spec.runner, backend: "kubernetes" } }) as Record<string, any>[];
    const secret = manifests.find((m) => m.kind === "Secret")!;
    expect(secret).toMatchObject({ type: "kubernetes.io/dockerconfigjson", metadata: { name: "kiln-a-pull" } });
    expect(JSON.parse(Buffer.from(secret.data[".dockerconfigjson"], "base64").toString()).auths["ghcr.io"]).toBeDefined();
    expect(manifests[0]!.spec.imagePullSecrets).toEqual([{ name: "kiln-a-pull" }]);
    expect(kubernetesManifests("kiln-b", "ns", { ...spec, registryAuth: undefined }).some((m) => m.kind === "Secret")).toBe(false);
    const fake = new FakeCommandRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const sbx = await new KubernetesSandboxProvider(fake).create({ ...spec, runner: { ...spec.runner, backend: "kubernetes" } });
    await sbx.destroy();
    expect(fake.calls.some((c) => c.args.includes("secret") && c.args.includes("delete"))).toBe(true);
  });
});
