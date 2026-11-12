// kiln bench from-prs: turn a team's merged pull requests into a backtest suite.
// Each task starts at the PR's base commit; only the judge sees the criteria, and the merged PR is the reference.
import { execFileSync } from "node:child_process";
import { stringify } from "yaml";

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  url: string;
  baseSha: string;
  author: string;
  additions: number;
  deletions: number;
  closingIssue?: { number: number; title: string; body: string };
};

export interface PullRequestSource {
  listMerged(repo: string, limit: number): Promise<PullRequest[]>;
}

export class FakePullRequestSource implements PullRequestSource {
  constructor(private readonly prs: PullRequest[]) {}
  async listMerged(_repo: string, limit: number) {
    return this.prs.slice(0, limit);
  }
}

const QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequests(states:MERGED,first:$n,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title body url baseRefOid additions deletions author{login} closingIssuesReferences(first:1){nodes{number title body}}}}}}`;

/** Reads merged pull requests with the GitHub CLI, so it reuses the person's `gh auth login`. */
export class GhPullRequestSource implements PullRequestSource {
  constructor(private readonly exec: (args: string[]) => string = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })) {}
  async listMerged(repo: string, limit: number) {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(`expected owner/name, got ${repo}`);
    let raw: string;
    try {
      raw = this.exec(["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `n=${Math.min(Math.max(limit, 1), 100)}`]);
    } catch (e) {
      throw new Error(
        `could not read pull requests with the GitHub CLI (is gh installed and logged in?): ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
      );
    }
    type Node = {
      number: number;
      title: string;
      body: string | null;
      url: string;
      baseRefOid: string;
      additions: number;
      deletions: number;
      author: { login: string } | null;
      closingIssuesReferences: { nodes: { number: number; title: string; body: string | null }[] };
    };
    const nodes = (JSON.parse(raw) as { data: { repository: { pullRequests: { nodes: Node[] } } } }).data.repository.pullRequests.nodes;
    return nodes.map((n): PullRequest => {
      const issue = n.closingIssuesReferences.nodes[0];
      return {
        number: n.number,
        title: n.title,
        body: n.body ?? "",
        url: n.url,
        baseSha: n.baseRefOid,
        author: n.author?.login ?? "ghost",
        additions: n.additions,
        deletions: n.deletions,
        closingIssue: issue ? { number: issue.number, title: issue.title, body: issue.body ?? "" } : undefined,
      };
    });
  }
}

const SIZE = (lines: number) => (lines <= 10 ? "xs" : lines <= 60 ? "s" : lines <= 300 ? "m" : "l");
const BOT = /(\[bot\]$|^dependabot|^renovate|^github-actions)/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]\s+(.+?)\s*$/;
// Headings that start describing the solution rather than the problem.
const SOLUTION = /^(#{1,6}\s*|\*\*)(changes?|implementation|how|solution|approach|what changed|testing|test plan|screenshots?|notes?)\b/i;

export function criteriaFrom(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^(#{1,6}\s*|\*\*)\s*acceptance criteria/i.test(l.trim()));
  if (start >= 0) {
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
      if (/^(#{1,6}\s|\*\*)/.test(l.trim()) && out.length) break;
      const m = LIST_ITEM.exec(l);
      if (m?.[1]) out.push(m[1]);
    }
    if (out.length) return out;
  }
  return lines.map((l) => CHECKBOX.exec(l)?.[1]).filter((x): x is string => !!x);
}

function problem(body: string): string {
  const lines = body.split(/\r?\n/),
    cut = lines.findIndex((l) => SOLUTION.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines)
    .filter((l) => !/^\s*(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+/i.test(l))
    .join("\n")
    .trim()
    .slice(0, 4000);
}

export function backtestSuite(repo: string, prs: PullRequest[], opts: { suite?: string; agent?: string } = {}) {
  const suite = opts.suite ?? "backtest",
    agent = opts.agent ?? "implement";
  const files: Record<string, string> = {};
  const skipped: { number: number; reason: string }[] = [];
  const names: string[] = [];
  for (const pr of prs) {
    if (BOT.test(pr.author)) {
      skipped.push({ number: pr.number, reason: `opened by ${pr.author}` });
      continue;
    }
    if (/^revert\b/i.test(pr.title)) {
      skipped.push({ number: pr.number, reason: "a revert" });
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(pr.baseSha)) {
      skipped.push({ number: pr.number, reason: "no base commit" });
      continue;
    }
    const criteria = criteriaFrom(pr.body).length ? criteriaFrom(pr.body) : criteriaFrom(pr.closingIssue?.body ?? "");
    const prompt = pr.closingIssue ? `# ${pr.closingIssue.title}\n\n${pr.closingIssue.body.trim()}` : `# ${pr.title}\n\n${problem(pr.body)}`;
    const name = `pr-${pr.number}`;
    names.push(name);
    files[`benchmarks/${suite}/tasks/${name}.yaml`] = stringify(
      {
        title: pr.title,
        prompt: prompt.trim(),
        successCriteria: criteria.length ? criteria : [`The behavior "${pr.title}" describes works, and the tests the reference pull request added pass.`],
        criteriaVisibility: "judge",
        startingRepoRefs: [`github.com:${repo}@${pr.baseSha}`],
        referencePr: pr.url,
        tags: [SIZE(pr.additions + pr.deletions)],
      },
      { lineWidth: 0 },
    );
  }
  if (names.length)
    files[`benchmarks/${suite}/suite.yaml`] = stringify(
      { name: suite, description: `Backtest on ${names.length} merged pull requests of ${repo}`, agent, configurations: [{ name: "current" }], tasks: names },
      { lineWidth: 0 },
    );
  return { files, skipped };
}
