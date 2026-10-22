import { GitHubForge, repoKey, type FakeForge, type PullRequest, type RepoRef } from "./forge";

export type GateMergeInput = {
  repo: RepoRef;
  number: number;
  /** The head commit the merge-safety decision saw; the merge is refused if the branch moved since. */
  expectedHeadSha: string;
  title: string;
};

/**
 * The merge gate's merge capability (ADR-014): the only code path in Kiln that merges a pull
 * request without a person. It is deliberately not on `Forge`, `PersonForge` or anything a run
 * can reach; the server builds one from its own credential and hands it to `MergeGateService`
 * alone.
 */
export interface GateMerger {
  /** The account the forge records as the merger. */
  readonly identity: string;
  merge(input: GateMergeInput): Promise<PullRequest>;
}

/** The forge will not merge this pull request as checked: the head moved, it is not open, or it is not mergeable. */
export class GateMergeConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateMergeConflict";
  }
}

/** Merges on the git-backed fake forge as `identity`, through the same protected-branch hook. */
export class FakeGateMerger implements GateMerger {
  constructor(
    private readonly forge: FakeForge,
    readonly identity = "kiln-merge-gate",
  ) {}

  async merge(input: GateMergeInput): Promise<PullRequest> {
    const pr = await this.forge.getPullRequest(input.repo, input.number);
    if (!pr || pr.state !== "open") throw new GateMergeConflict(`pull request ${repoKey(input.repo)}#${input.number} is not open`);
    if (pr.headSha !== input.expectedHeadSha)
      throw new GateMergeConflict(`pull request ${repoKey(input.repo)}#${input.number} changed after the merge-safety decision`);
    try {
      return await this.forge.merge(input.repo, input.number, this.identity);
    } catch (err) {
      throw new GateMergeConflict(`pull request ${repoKey(input.repo)}#${input.number} cannot be merged: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * GitHub merges with a credential of the gate's own (KILN_MERGE_GATE_TOKEN), never the forge's
 * app token or a sandbox token. `sha` makes GitHub refuse the merge when the head moved.
 */
export class GitHubGateMerger implements GateMerger {
  readonly identity: string;
  /** Reads the merged pull request back with the gate's own token. */
  private readonly reader: GitHubForge;

  constructor(private readonly options: { token: string; identity: string; baseUrl?: string; fetch?: typeof fetch }) {
    this.identity = options.identity;
    this.reader = new GitHubForge({ token: options.token, baseUrl: options.baseUrl, fetch: options.fetch });
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const doFetch = this.options.fetch ?? fetch;
    return doFetch(`${this.options.baseUrl ?? "https://api.github.com"}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async merge(input: GateMergeInput): Promise<PullRequest> {
    const key = repoKey(input.repo);
    const res = await this.call("PUT", `/repos/${key}/pulls/${input.number}/merge`, {
      sha: input.expectedHeadSha,
      merge_method: "merge",
      commit_title: `${input.title} (#${input.number})`,
    });
    if (res.status === 405 || res.status === 409 || res.status === 422)
      throw new GateMergeConflict(`GitHub did not merge ${key}#${input.number} (${res.status}): ${await res.text()}`);
    if (!res.ok) throw new Error(`GitHub PUT /repos/${key}/pulls/${input.number}/merge returned ${res.status}: ${await res.text()}`);
    const pr = await this.reader.getPullRequest(input.repo, input.number);
    if (!pr) throw new Error(`GitHub merged ${key}#${input.number} but no longer finds it`);
    return pr;
  }
}
