import { imageRegistry, NodeCommandRunner, type CommandRunner, type RegistryAuth } from "@kiln/sandbox";
import type { Kiln } from "../kiln";

/** Exchanges an aws_ecr secret (role ARN and region) for a short-lived registry password. */
export interface EcrTokenProvider {
  password(input: { roleArn: string; region: string; registry: string }): Promise<string>;
}

/**
 * Uses the AWS CLI on the server: `aws ecr get-login-password`. The server's AWS credentials (an
 * instance role, a web identity, or AWS_* variables) must be able to call ecr:GetAuthorizationToken
 * for the registry; the role ARN is passed as AWS_ROLE_ARN for web-identity setups.
 */
export class CliEcrTokenProvider implements EcrTokenProvider {
  constructor(private readonly runner: CommandRunner = new NodeCommandRunner()) {}

  async password(input: { roleArn: string; region: string }): Promise<string> {
    const version = await this.runner.run("aws", ["--version"]).catch(() => ({ code: 127, stdout: "", stderr: "" }));
    if (version.code !== 0) throw new Error("pulling from ECR needs the AWS CLI on the Kiln server (aws ecr get-login-password)");
    const r = await this.runner.run("aws", ["ecr", "get-login-password", "--region", input.region], { env: { AWS_ROLE_ARN: input.roleArn } });
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(`aws ecr get-login-password failed: ${r.stderr.trim() || "no token"}`);
    return r.stdout.trim();
  }
}

export class FakeEcrTokenProvider implements EcrTokenProvider {
  readonly calls: { roleArn: string; region: string; registry: string }[] = [];
  constructor(private readonly token = "ecr-token") {}
  async password(input: { roleArn: string; region: string; registry: string }) {
    this.calls.push(input);
    return this.token;
  }
}

/** The pull credential a runner or environment names, checked against the image's registry. */
export async function registryAuthFor(k: Kiln, teamId: string | undefined, secretName: string, image: string): Promise<RegistryAuth> {
  const cred = teamId ? k.vault.registryCredential(teamId, secretName) : undefined;
  if (!cred) throw new Error(`registry credential ${secretName} is not a docker_registry or aws_ecr team secret`);
  const registry = imageRegistry(image);
  if (cred.type === "docker_registry") {
    const v = cred.value as { host: string; username: string; password: string };
    const host = v.host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const same = host === registry || (registry === "docker.io" && ["index.docker.io", "registry-1.docker.io"].includes(host));
    if (!same) throw new Error(`registry credential ${secretName} is for ${host}, but the image ${image} is on ${registry}`);
    return { host: registry, username: v.username, password: v.password };
  }
  const v = cred.value as { roleArn: string; region: string };
  if (!/\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(registry)) throw new Error(`registry credential ${secretName} is for ECR, but the image ${image} is not on an ECR registry`);
  const password = await (k.options.ecr ?? new CliEcrTokenProvider()).password({ ...v, registry });
  return { host: registry, username: "AWS", password };
}
