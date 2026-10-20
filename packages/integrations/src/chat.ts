import type { CommandRunner } from "@kiln/sandbox";

export type ChatMessage = { channel: string; thread?: string; text: string; ts: string; fileUrl?: string };

/** Post as the factory where the provider allows it (Slack chat:write.customize, Discord webhooks). */
export type ChatIdentity = { name?: string; iconUrl?: string };
export type ChatPost = { channel: string; thread?: string; text: string; fileUrl?: string; as?: ChatIdentity };

export interface Chat {
  readonly name: "slack" | "discord" | "teams" | "fake";
  post(input: ChatPost): Promise<ChatMessage>;
  /** Add a reaction (Slack 👀 acknowledgement, Discord). Teams bots cannot react. */
  react?(input: { channel: string; ts: string; emoji: string }): Promise<void>;
  /** Send a direct message to a user id of this provider. */
  directMessage?(user: string, text: string): Promise<ChatMessage>;
}

export class FakeChat implements Chat {
  readonly messages: ChatMessage[] = [];
  readonly reactions: { channel: string; ts: string; emoji: string }[] = [];
  readonly dms: { user: string; text: string }[] = [];
  readonly identities: (ChatIdentity | undefined)[] = [];

  constructor(readonly name: Chat["name"] = "fake") {}

  async post(input: ChatPost) {
    const { as, ...rest } = input;
    const msg = { ...rest, ts: `${Date.now()}.${String(this.messages.length).padStart(6, "0")}` };
    this.messages.push(msg);
    this.identities.push(as);
    return msg;
  }

  async react(input: { channel: string; ts: string; emoji: string }) {
    this.reactions.push(input);
  }

  async directMessage(user: string, text: string) {
    this.dms.push({ user, text });
    return this.post({ channel: `dm:${user}`, text });
  }

  inThread(channel: string, thread: string) {
    return this.messages.filter((m) => m.channel === channel && m.thread === thread);
  }
}

export class SlackChat implements Chat {
  readonly name = "slack" as const;

  constructor(private readonly options: { botToken: string; fetch?: typeof fetch }) {}

  /** Call a Slack Web API method with a JSON body. */
  async call<T extends { ok: boolean; error?: string }>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await (this.options.fetch ?? fetch)(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${this.options.botToken}` },
      body: JSON.stringify(body),
    });
    const out = (await res.json()) as T;
    if (!out.ok) throw new Error(`Slack ${method} failed: ${out.error}`);
    return out;
  }

  async post(input: ChatPost) {
    const text = input.fileUrl ? `${input.text}\n${input.fileUrl}` : input.text;
    const body = await this.call<{ ok: boolean; ts?: string; error?: string }>("chat.postMessage", {
      channel: input.channel,
      thread_ts: input.thread,
      text,
      unfurl_links: false,
      ...(input.as?.name ? { username: input.as.name } : {}),
      ...(input.as?.iconUrl ? { icon_url: input.as.iconUrl } : {}),
    });
    return { channel: input.channel, thread: input.thread, text, ts: body.ts! };
  }

  async react(input: { channel: string; ts: string; emoji: string }) {
    try {
      await this.call("reactions.add", { channel: input.channel, timestamp: input.ts, name: input.emoji });
    } catch (err) {
      if (!String(err).includes("already_reacted")) throw err;
    }
  }

  async directMessage(user: string, text: string) {
    const open = await this.call<{ ok: boolean; channel: { id: string } }>("conversations.open", { users: user });
    return this.post({ channel: open.channel.id, text });
  }

  /** The App Home tab for one user. */
  async publishHome(user: string, view: Record<string, unknown>) {
    await this.call("views.publish", { user_id: user, view });
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
