import { randomBytes } from "node:crypto";
import {
  githubAppInstallUrl,
  githubAppManifest,
  githubManifestAction,
  HttpGitHubManifests,
  type GitHubAppCredentials,
  type GitHubManifestClient,
} from "@kiln/integrations";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";

const APPS = "github_app";
const STATES = "github_app_states";
const STATE_TTL_MS = 60 * 60 * 1000;

/** One app per account or organization; `id` is its slug (the first app ever created here is "default"). */
type Stored = { id: string; sealed: string; slug: string; appId: string; owner?: string; installationId?: string; createdBy: string; createdAt: string };
type ManifestState = { id: string; step: "create" | "install"; by: string; expiresAt: string; app?: string };

/** The GitHub App, without its secrets. */
export type GitHubAppInfo = { appId: string; slug: string; owner?: string; installationId?: string; createdBy: string; createdAt: string; installUrl: string };

/**
 * Kiln's own GitHub Apps, one per account or organization, created from a manifest: an admin clicks Create on GitHub, GitHub hands
 * the app's key and webhook secret to the server, and the admin installs it. The credentials are
 * sealed in their own collection, never reachable as a named secret (agents can ask for secrets
 * by name, and this key can merge).
 */
export class GitHubAppService {
  private readonly client: GitHubManifestClient;

  constructor(private readonly k: Kiln) {
    this.client = k.options.githubManifests ?? new HttpGitHubManifests();
  }

  /** The manifest and the URL the browser posts it to. */
  start(by: string, opts: { org?: string; name?: string } = {}) {
    const publicUrl = this.k.options.publicUrl;
    if (!publicUrl) throw new KilnError("invalid_request", "set KILN_PUBLIC_URL first: GitHub sends webhooks and the setup redirect there");
    if (!this.k.options.secretKey) throw new KilnError("invalid_request", "set KILN_SECRET_KEY first: the app's private key is stored encrypted with it");
    const state = this.newState("create", by);
    const manifest = githubAppManifest({
      name: opts.name ?? (opts.org ? `Kiln for ${opts.org}` : `Kiln ${new URL(publicUrl).hostname.split(".")[0]}`),
      publicUrl,
      webUrl: this.k.options.webUrl ?? publicUrl,
    });
    return { action: githubManifestAction(state, opts.org), manifest, state };
  }

  /** GitHub's redirect after Create: turn the code into the app, keep it, and continue to installation. */
  async created(code: string, state: string): Promise<{ installUrl: string; app: GitHubAppInfo }> {
    const s = this.takeState(state, "create");
    const creds = await this.client.convert(code);
    const now = this.k.clock.now().toISOString();
    this.k.store.put(APPS, {
      id: this.find(creds.slug)?.id ?? creds.slug,
      sealed: this.k.vault.seal(creds),
      slug: creds.slug,
      appId: creds.appId,
      owner: creds.owner,
      createdBy: s.by,
      createdAt: now,
    } satisfies Stored);
    this.k.audit(s.by, "github_app.created", creds.slug, { appId: creds.appId, owner: creds.owner });
    this.k.options.onGitHubApp?.(creds);
    const installUrl = githubAppInstallUrl(creds.slug, this.newState("install", s.by, creds.slug));
    return { installUrl, app: this.list().find((a) => a.slug === creds.slug)! };
  }

  /** GitHub's redirect after the app is installed (setup URL). Returns who started the flow. */
  installed(installationId: string, state: string): { by: string } {
    const s = this.takeState(state, "install");
    const stored = s.app ? this.find(s.app) : this.stored()[0];
    if (!stored) throw new KilnError("resource_not_found", "no GitHub App has been created yet");
    this.k.store.put(APPS, { ...stored, installationId });
    this.k.audit(s.by, "github_app.installed", stored.slug, { installationId });
    return { by: s.by };
  }

  /**
   * Forgets an app (one created by mistake, or a duplicate): its credentials go, and Kiln stops using it
   * for the forge and webhooks. The app itself stays on GitHub until someone deletes it there.
   */
  remove(slug: string, by: string): void {
    const stored = this.find(slug);
    if (!stored) throw new KilnError("resource_not_found", `no GitHub App ${slug}`);
    this.k.store.delete(APPS, stored.id);
    this.k.audit(by, "github_app.removed", slug, { appId: stored.appId, owner: stored.owner, installationId: stored.installationId });
    this.k.options.onGitHubAppRemoved?.(slug);
  }

  /** Every app, oldest first, without secrets. */
  list(): GitHubAppInfo[] {
    return this.stored().map((s) => ({ appId: s.appId, slug: s.slug, owner: s.owner, installationId: s.installationId, createdBy: s.createdBy, createdAt: s.createdAt, installUrl: `https://github.com/apps/${s.slug}/installations/new` }));
  }

  /** The first app (the one most installs have). */
  info(): GitHubAppInfo | undefined {
    return this.list()[0];
  }

  /** The apps' credentials, for the forge and webhook verification only. */
  allCredentials(): (GitHubAppCredentials & { installationId?: string })[] {
    return this.stored().map((s) => ({ ...(this.k.vault.unseal(s.sealed) as GitHubAppCredentials), installationId: s.installationId }));
  }

  credentials(): (GitHubAppCredentials & { installationId?: string }) | undefined {
    return this.allCredentials()[0];
  }

  /** Reseals the apps' credentials still under the previous KILN_SECRET_KEY; returns how many. */
  rotate(): number {
    let n = 0;
    for (const s of this.stored()) {
      const sealed = this.k.vault.reseal(s.sealed);
      if (sealed === undefined) continue;
      this.k.store.put(APPS, { ...s, sealed } satisfies Stored);
      n++;
    }
    return n;
  }

  private stored(): Stored[] {
    return this.k.store.list<Stored>(APPS).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private find(slug: string): Stored | undefined {
    return this.stored().find((s) => s.slug === slug);
  }

  private newState(step: ManifestState["step"], by: string, app?: string) {
    const id = randomBytes(24).toString("base64url");
    this.k.store.put(STATES, { id, step, by, ...(app ? { app } : {}), expiresAt: new Date(this.k.clock.now().getTime() + STATE_TTL_MS).toISOString() } satisfies ManifestState);
    return id;
  }

  /** Single use, an hour at most, and only for the step it was issued for. */
  private takeState(id: string, step: ManifestState["step"]): ManifestState {
    const s = id ? this.k.store.get<ManifestState>(STATES, id) : undefined;
    if (s) this.k.store.delete(STATES, id);
    if (!s || s.step !== step || s.expiresAt < this.k.clock.now().toISOString())
      throw new KilnError("invalid_request", "this GitHub setup link has expired or was already used; start again from Integrations");
    return s;
  }
}
