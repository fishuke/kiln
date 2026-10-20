import { FakeHarness } from "@kiln/harness";
import { FakeCommandRunner, LocalSandboxProvider, type Sandbox, type SandboxProvider, type SandboxSpec } from "@kiln/sandbox";
import { describe, expect, it } from "vitest";
import { createTestKiln, sampleTree } from "../testing";
import { CliEcrTokenProvider, FakeEcrTokenProvider } from "./registry";

/** A "docker" provider that records specs and runs locally. */
class RecordingProvider implements SandboxProvider {
  readonly name = "docker";
  readonly specs: SandboxSpec[] = [];
  private readonly local = new LocalSandboxProvider();
  create(spec: SandboxSpec): Promise<Sandbox> {
    this.specs.push(spec);
    return this.local.create({ ...spec, runner: { ...spec.runner, setupCommands: [] } });
  }
  resume(...args: Parameters<SandboxProvider["resume"]>) {
    return this.local.resume(...args);
  }
}

function setup(runnerYaml: string, extra: Record<string, string> = {}) {
  const docker = new RecordingProvider();
  const ecr = new FakeEcrTokenProvider("ecr-pass");
  const tree = sampleTree({ "runners/private.yaml": runnerYaml, "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nrunner: private\n---\nBuild.\n", ...extra });
  const t = createTestKiln({ harness: () => new FakeHarness(async () => ({ summary: "ok" })), tree, sandboxes: { docker }, ecr });
  const team = t.kiln.teams.ensureDefaultTeam();
  const sha = t.kiln.defs.require("webapp").appliedSha!;
  const run = () => t.kiln.runs.execute({ factory: "webapp", sha, agent: "implement", prompt: "x", push: false });
  return { ...t, docker, ecr, team, run };
}

describe("registry credentials", () => {
  it("passes a docker_registry secret whose host matches the image", async () => {
    const s = setup("image: ghcr.io/acme/runner:1\nbackend: docker\nplatform:\n  linux:\n    registryCredentialSecretName: GHCR\n");
    await expect(s.run()).rejects.toThrow("registry credential GHCR is not a docker_registry or aws_ecr team secret");
    s.kiln.vault.set({ scope: "team", owner: s.team.id, name: "GHCR", type: "docker_registry", value: { host: "ghcr.io", username: "bot", password: "ghp_x" } }, "a");
    await s.run();
    expect(s.docker.specs.at(-1)!.registryAuth).toEqual({ host: "ghcr.io", username: "bot", password: "ghp_x" });
    s.kiln.vault.set({ scope: "team", owner: s.team.id, name: "QUAY", type: "docker_registry", value: { host: "quay.io", username: "bot", password: "q" } }, "a");
    const other = setup("image: ghcr.io/acme/runner:1\nbackend: docker\nplatform: { linux: { registryCredentialSecretName: QUAY } }\n");
    other.kiln.vault.set({ scope: "team", owner: other.team.id, name: "QUAY", type: "docker_registry", value: { host: "quay.io", username: "bot", password: "q" } }, "a");
    await expect(other.run()).rejects.toThrow("is for quay.io, but the image ghcr.io/acme/runner:1 is on ghcr.io");
  });

  it("exchanges an aws_ecr secret for a pull password", async () => {
    const image = "123456789012.dkr.ecr.eu-west-1.amazonaws.com/runner:1";
    const s = setup(`image: ${image}\nbackend: docker\nplatform: { linux: { registryCredentialSecretName: ECR } }\n`);
    s.kiln.vault.set({ scope: "team", owner: s.team.id, name: "ECR", type: "aws_ecr", value: { roleArn: "arn:aws:iam::123456789012:role/kiln-pull", region: "eu-west-1" } }, "a");
    await s.run();
    expect(s.ecr.calls).toEqual([{ roleArn: "arn:aws:iam::123456789012:role/kiln-pull", region: "eu-west-1", registry: "123456789012.dkr.ecr.eu-west-1.amazonaws.com" }]);
    expect(s.docker.specs[0]!.registryAuth).toEqual({ host: "123456789012.dkr.ecr.eu-west-1.amazonaws.com", username: "AWS", password: "ecr-pass" });
  });

  it("the CLI token provider runs aws ecr get-login-password, and says so when the CLI is missing", async () => {
    const ok = new FakeCommandRunner((_cmd, args) => (args[0] === "--version" ? ["aws-cli/2"] : ["token-from-cli"]));
    expect(await new CliEcrTokenProvider(ok).password({ roleArn: "arn:aws:iam::1:role/x", region: "eu-west-1" })).toBe("token-from-cli");
    expect(ok.calls[1]).toMatchObject({ cmd: "aws", args: ["ecr", "get-login-password", "--region", "eu-west-1"], opts: { env: { AWS_ROLE_ARN: "arn:aws:iam::1:role/x" } } });
    const missing = new FakeCommandRunner(() => ({ code: 127, stdout: "", stderr: "not found" }));
    await expect(new CliEcrTokenProvider(missing).password({ roleArn: "r", region: "eu-west-1" })).rejects.toThrow("needs the AWS CLI");
  });

  it("an environment's image can name its own registry credential", async () => {
    const docker = new RecordingProvider();
    const tree = sampleTree({ "factory.yaml": sampleTree()["factory.yaml"]!.replace("agentDefaults:\n", "agentDefaults:\n  environmentId: private-env\n") });
    const { kiln } = createTestKiln({ harness: () => new FakeHarness(async () => ({ summary: "ok" })), tree, sandboxes: { docker }, defaultBackend: "docker" });
    const team = kiln.teams.ensureDefaultTeam();
    kiln.vault.set({ scope: "team", owner: team.id, name: "HUB", type: "docker_registry", value: { host: "index.docker.io", username: "bot", password: "dckr" } }, "a");
    kiln.environments.create(team.id, { name: "private-env", image: "acme/private-runner:2", registryCredentialSecretName: "HUB" }, "a");
    await kiln.runs.execute({ factory: "webapp", sha: kiln.defs.require("webapp").appliedSha!, agent: "implement", prompt: "x", push: false });
    expect(docker.specs[0]).toMatchObject({ runner: { image: "acme/private-runner:2" }, registryAuth: { host: "docker.io", username: "bot", password: "dckr" } });
  });
});
