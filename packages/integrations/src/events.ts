export type EventProvider =
  | "github"
  | "gitlab"
  | "azure_devops"
  | "bitbucket"
  | "linear"
  | "jira"
  | "slack"
  | "teams"
  | "discord"
  | "webhook"
  | "schedule"
  | "factory"
  | "kiln";

/**
 * A provider event in the shape automation filters read. Field names follow the filter keys
 * (`repos`, `labels`, `mentioned`, `team_ids`, `channel_ids`, …; see the engine's matchers for
 * the few that differ, such as `author` for `authors`), plus the text and links a work item needs.
 */
export type IncomingEvent = {
  provider: EventProvider;
  event: string;
  deliveryId?: string;
  data: {
    repo?: string;
    repos?: string[];
    number?: number;
    labels?: string[];
    mentioned?: string[];
    team_ids?: string[];
    channel?: string;
    channel_ids?: string[];
    user_ids?: string[];
    thread?: string;
    title?: string;
    body?: string;
    text?: string;
    url?: string;
    author?: string;
    /** The actor is a bot / is Kiln itself (skip_bots). */
    authorIsBot?: boolean;
    authorIsSelf?: boolean;
    merged?: boolean;
    head?: string;
    base?: string;
    branch?: string;
    issueId?: string;
    /** A plain reply in a thread (no mention of the app). */
    isThreadReply?: boolean;
    [k: string]: unknown;
  };
};

/** Drop fenced and inline code so mentions inside code don't count. */
export function stripCode(text: string | undefined): string {
  return (text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
}

export function mentionsIn(text: string | undefined): string[] {
  return [...new Set([...stripCode(text).matchAll(/(?:^|[^\w])@([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?(?:\[bot\])?)/gi)].map((m) => m[1]!.toLowerCase()))];
}

/** Remembers delivery ids so provider retries do not start the same work twice. */
export class DeliveryDedupe {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 24 * 3600_000) {}

  firstTime(id: string | undefined, now = Date.now()): boolean {
    if (!id) return true;
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
}

export const uniq = <T>(xs: (T | undefined | null)[]): T[] => [...new Set(xs.filter((x): x is T => x !== undefined && x !== null && x !== ""))];
