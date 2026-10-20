import type { CommandRunner } from "@kiln/sandbox";

export type ChatMessage = { channel: string; thread?: string; text: string; ts: string; fileUrl?: string };

export interface Chat {
  readonly name: "slack" | "fake";
  post(input: { channel: string; thread?: string; text: string; fileUrl?: string }): Promise<ChatMessage>;
}

export class FakeChat implements Chat {
  readonly name = "fake" as const;
  readonly messages: ChatMessage[] = [];

  async post(input: { channel: string; thread?: string; text: string; fileUrl?: string }) {
    const msg = { ...input, ts: `${Date.now()}.${String(this.messages.length).padStart(6, "0")}` };
    this.messages.push(msg);
    return msg;
  }

  inThread(channel: string, thread: string) {
    return this.messages.filter((m) => m.channel === channel && m.thread === thread);
  }
}

export class SlackChat implements Chat {
  readonly name = "slack" as const;

  constructor(private readonly options: { botToken: string; fetch?: typeof fetch }) {}

  async post(input: { channel: string; thread?: string; text: string; fileUrl?: string }) {
    const text = input.fileUrl ? `${input.text}\n${input.fileUrl}` : input.text;
    const res = await (this.options.fetch ?? fetch)("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${this.options.botToken}` },
      body: JSON.stringify({ channel: input.channel, thread_ts: input.thread, text, unfurl_links: false }),
    });
    const body = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!body.ok) throw new Error(`Slack chat.postMessage failed: ${body.error}`);
    return { channel: input.channel, thread: input.thread, text, ts: body.ts! };
  }
}

export interface PreviewProvider {
  readonly name: string;
  deploy(input: { repo: string; branch: string; pr: number }): Promise<{ url: string; id: string }>;
  destroy(id: string): Promise<void>;
}

export class FakePreview implements PreviewProvider {
  readonly name = "fake";
  readonly deployments = new Map<string, { url: string; branch: string }>();

  async deploy(input: { repo: string; branch: string; pr: number }) {
    const id = `${input.repo.replace("/", "-")}-pr-${input.pr}`;
    const url = `https://pr-${input.pr}.${input.repo.split("/")[1]}.preview.test`;
    this.deployments.set(id, { url, branch: input.branch });
    return { url, id };
  }

  async destroy(id: string) {
    this.deployments.delete(id);
  }
}

export class VercelPreview implements PreviewProvider {
  readonly name = "vercel";

  constructor(private readonly options: { token: string; project: string; teamId?: string; fetch?: typeof fetch }) {}

  async deploy(input: { repo: string; branch: string; pr: number }) {
    const q = this.options.teamId ? `?teamId=${this.options.teamId}` : "";
    const res = await (this.options.fetch ?? fetch)(`https://api.vercel.com/v13/deployments${q}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.options.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: this.options.project,
        target: "preview",
        gitSource: { type: "github", repo: input.repo.split("/")[1], org: input.repo.split("/")[0], ref: input.branch },
      }),
    });
    if (!res.ok) throw new Error(`Vercel deploy failed with ${res.status}`);
    const body = (await res.json()) as { id: string; url: string };
    return { id: body.id, url: `https://${body.url}` };
  }

  async destroy(id: string) {
    await (this.options.fetch ?? fetch)(`https://api.vercel.com/v13/deployments/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.options.token}` },
    });
  }
}

/** One namespace per pull request, with a Deployment, Service and Ingress. */
export class KubernetesPreview implements PreviewProvider {
  readonly name = "kubernetes";

  constructor(
    private readonly options: { runner: CommandRunner; domain: string; image: (repo: string, branch: string) => string; port?: number },
  ) {}

  manifests(input: { repo: string; branch: string; pr: number }) {
    const ns = `preview-${input.repo.split("/")[1]}-pr-${input.pr}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
    const host = `pr-${input.pr}.${input.repo.split("/")[1]}.${this.options.domain}`;
    const labels = { app: "preview", "kiln.dev/pr": String(input.pr) };
    const port = this.options.port ?? 3000;
    return {
      ns,
      host,
      docs: [
        { apiVersion: "v1", kind: "Namespace", metadata: { name: ns, labels: { "kiln.dev/preview": "true" } } },
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: { name: "app", namespace: ns },
          spec: {
            replicas: 1,
            selector: { matchLabels: labels },
            template: { metadata: { labels }, spec: { containers: [{ name: "app", image: this.options.image(input.repo, input.branch), ports: [{ containerPort: port }] }] } },
          },
        },
        { apiVersion: "v1", kind: "Service", metadata: { name: "app", namespace: ns }, spec: { selector: labels, ports: [{ port: 80, targetPort: port }] } },
        {
          apiVersion: "networking.k8s.io/v1",
          kind: "Ingress",
          metadata: { name: "app", namespace: ns },
          spec: { rules: [{ host, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "app", port: { number: 80 } } } }] } }] },
        },
      ],
    };
  }

  async deploy(input: { repo: string; branch: string; pr: number }) {
    const { ns, host, docs } = this.manifests(input);
    const r = await this.options.runner.run("kubectl", ["apply", "-f", "-"], { stdin: docs.map((d) => JSON.stringify(d)).join("\n") });
    if (r.code !== 0) throw new Error(`kubectl apply failed: ${r.stderr}`);
    return { id: ns, url: `https://${host}` };
  }

  async destroy(id: string) {
    await this.options.runner.run("kubectl", ["delete", "namespace", id, "--ignore-not-found"]);
  }
}
