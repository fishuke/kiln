/** The GitHub account behind an OAuth login. */
export type GitHubIdentity = { id: string; login: string; name?: string; email?: string; avatarUrl?: string };

/** GitHub OAuth login: build the authorize URL, then trade the callback code for an identity. */
export interface GitHubOAuth {
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<GitHubIdentity>;
}

export class GitHubOAuthClient implements GitHubOAuth {
  constructor(
    private readonly options: { clientId: string; clientSecret: string; baseUrl?: string; apiUrl?: string; fetch?: typeof fetch },
  ) {}

  private get web() {
    return (this.options.baseUrl ?? "https://github.com").replace(/\/$/, "");
  }

  private get api() {
    return (this.options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: this.options.clientId, redirect_uri: redirectUri, state, scope: "read:user user:email", allow_signup: "false" });
    return `${this.web}/login/oauth/authorize?${q}`;
  }

  async exchange(code: string, redirectUri: string): Promise<GitHubIdentity> {
    const f = this.options.fetch ?? fetch;
    const res = await f(`${this.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.options.clientId, client_secret: this.options.clientSecret, code, redirect_uri: redirectUri }),
    });
    const token = (await res.json()) as { access_token?: string; error_description?: string };
    if (!token.access_token) throw new Error(`GitHub login failed: ${token.error_description ?? res.status}`);
    const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json" };
    const user = (await (await f(`${this.api}/user`, { headers })).json()) as { id: number; login: string; name?: string; email?: string; avatar_url?: string };
    let email = user.email ?? undefined;
    if (!email) {
      const emails = (await (await f(`${this.api}/user/emails`, { headers })).json()) as { email: string; primary: boolean; verified: boolean }[];
      email = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified)?.email : undefined;
    }
    return { id: String(user.id), login: user.login, name: user.name ?? undefined, email, avatarUrl: user.avatar_url };
  }
}

/** Test stand-in: codes map to identities. */
export class FakeGitHubOAuth implements GitHubOAuth {
  readonly codes = new Map<string, GitHubIdentity>();

  authorizeUrl(state: string, redirectUri: string): string {
    return `https://github.test/login/oauth/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchange(code: string): Promise<GitHubIdentity> {
    const identity = this.codes.get(code);
    if (!identity) throw new Error("GitHub login failed: bad_verification_code");
    return identity;
  }
}
