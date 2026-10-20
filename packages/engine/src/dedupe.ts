import type { Kiln } from "./kiln";
import { isActive } from "./state";
import type { Attachment, Source, WorkItem } from "./types";

export type DedupeConfig = { enabled: boolean; windowHours: number; threshold: number };
export const DEFAULT_DEDUPE: DedupeConfig = { enabled: true, windowHours: 24, threshold: 0.5 };

export type IncomingReport = {
  factory: string;
  title: string;
  body: string;
  source: Source;
  requester: string;
  trackerKey?: string;
  correlationKey?: string;
  attachments?: Attachment[];
};

export type DuplicateMatch = { target: WorkItem; reason: "key" | "similarity" | "triage"; score: number; key?: string; shared?: string[] };

/** Payload fields alerting tools use for "the same incident". */
const KEY_FIELDS = /"(fingerprint|dedup_key|dedupKey|dedupe_key|incident_id|incidentId|incident_key|incidentKey|alert_id|alertId|group_key|groupKey|correlation_id|correlationId)"\s*:\s*"([^"]{1,200})"/g;

/** Identity keys of a report: explicit, from alert payloads, the tracker issue, the source URL or PR. */
export function correlationKeys(r: Pick<IncomingReport, "source" | "trackerKey" | "correlationKey" | "body">): string[] {
  const keys = new Set<string>();
  if (r.correlationKey) keys.add(`key:${r.correlationKey}`);
  for (const m of r.body.matchAll(KEY_FIELDS)) keys.add(`key:${m[2]}`);
  if (r.trackerKey) keys.add(`issue:${r.trackerKey.toUpperCase()}`);
  if (r.source.issueId) keys.add(`issue:${r.source.issueId.toUpperCase()}`);
  if (r.source.url) keys.add(`url:${r.source.url.replace(/[#?].*$/, "").replace(/\/$/, "")}`);
  if (r.source.repo && r.source.number) keys.add(`gh:${r.source.repo.toLowerCase()}#${r.source.number}`);
  return [...keys];
}

const STOP = new Set(
  "the and for with from that this have has had are was were been not but you your our can cannot will would should could when what where which who how all any some get getting got into onto about after before again also just like than then them they their there here very more most please thanks thank hello team issue issues problem problems seems seem still now today yesterday since users user customer customers something anything".split(" "),
);

/** Strong tokens: error codes, status codes, identifiers with digits, URLs and hosts. */
const STRONG = /^(\d{3}|\dxx|[a-z]+-\d+|[a-z_]*err[a-z_]*\d*|[a-z0-9.-]+\.[a-z]{2,}|[a-z0-9]+_[a-z0-9_]+|0x[0-9a-f]+|[0-9a-f]{7,})$/;

const INCIDENT = /\b(down|outage|incident|alert|alarm|5\d\d|5xx|error|errors|failing|failed|failure|crash|crashes|crashing|exception|timeout|timeouts|latency|degraded|unavailable|sev\d|p[0-2]|pager|on-?call|broken)\b/i;

export function salientTokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const url of lower.match(/https?:\/\/[^\s)]+/g) ?? []) {
    try {
      out.add(new URL(url).host);
    } catch {
      /* not a URL */
    }
  }
  for (const raw of lower.replace(/https?:\/\/[^\s)]+/g, " ").split(/[^a-z0-9_.-]+/)) {
    const word = raw.replace(/^[._-]+|[._-]+$/g, "");
    if (!word) continue;
    const parts = /[-_.]/.test(word) && !STRONG.test(word) ? [word, ...word.split(/[-_.]/)] : [word];
    for (const p of parts) {
      if (p.length < 3 && !/^\d{3}$/.test(p)) continue;
      if (STOP.has(p)) continue;
      out.add(p.length > 4 && p.endsWith("s") && !p.endsWith("ss") ? p.slice(0, -1) : p);
    }
  }
  return out;
}

/** Overlap of salient tokens (|A∩B| / min(|A|,|B|)) and the strong tokens they share. */
export function similarity(a: string, b: string): { score: number; shared: string[]; strong: string[] } {
  const ta = salientTokens(a);
  const tb = salientTokens(b);
  if (!ta.size || !tb.size) return { score: 0, shared: [], strong: [] };
  const shared = [...ta].filter((t) => tb.has(t));
  return { score: shared.length / Math.min(ta.size, tb.size), shared, strong: shared.filter((t) => STRONG.test(t)) };
}

export const looksLikeIncident = (text: string) => INCIDENT.test(text);

/**
 * Keeps one task per incident: a report that matches an open task by identity (alert
 * fingerprint, tracker issue, URL) or, from a different source, by content, is added to that
 * task instead of starting new work. Updates then go to every place it was reported.
 */
export class DedupeService {
  constructor(private readonly k: Kiln) {}

  config(factory: string): DedupeConfig {
    const d = this.k.defs.current(factory).factory.deduplication;
    return { ...DEFAULT_DEDUPE, ...(d ?? {}) };
  }

  private candidates(factory: string, windowHours: number): WorkItem[] {
    const since = new Date(this.k.clock.now().getTime() - windowHours * 3_600_000).toISOString();
    return this.k.workflow.list({ factory }).filter((w) => !w.deletedAt && !w.duplicateOf && isActive(w.state) && w.updatedAt >= since);
  }

  /** The open task this report belongs to, if any. */
  find(report: IncomingReport): DuplicateMatch | undefined {
    let cfg: DedupeConfig;
    try {
      cfg = this.config(report.factory);
    } catch {
      return undefined;
    }
    if (!cfg.enabled) return undefined;
    const keys = correlationKeys(report);
    const pool = this.candidates(report.factory, cfg.windowHours);
    for (const w of pool) {
      const shared = keys.find((k) => (w.correlationKeys ?? []).includes(k));
      if (shared) return { target: w, reason: "key", score: 1, key: shared };
    }
    const text = `${report.title}\n${report.body}`;
    let best: DuplicateMatch | undefined;
    for (const w of pool) {
      const sources = [w.source, ...(w.linkedSources ?? [])];
      // Content matches only across sources: two requests from the same place are kept apart.
      if (sources.some((s) => s.provider === report.source.provider && (s.channel ?? s.repo ?? s.automation ?? "") === (report.source.channel ?? report.source.repo ?? report.source.automation ?? ""))) continue;
      const other = `${w.title}\n${w.body}`;
      if (!looksLikeIncident(text) && !looksLikeIncident(other)) continue;
      const sim = similarity(text, other);
      if (sim.score < cfg.threshold || (sim.strong.length === 0 && sim.shared.length < 3)) continue;
      if (!best || sim.score > best.score) best = { target: w, reason: "similarity", score: Math.round(sim.score * 100) / 100, shared: sim.shared };
    }
    return best;
  }

  /** Add a report to an existing task: its words, files and origin. Returns the updated task. */
  attach(targetId: string, report: IncomingReport, match: Omit<DuplicateMatch, "target">, duplicateId?: string): WorkItem {
    const now = this.k.clock.now().toISOString();
    const via = `${report.source.provider}${report.source.url ? ` (${report.source.url})` : ""}`;
    const updated = this.k.workflow.update(targetId, (w) => {
      w.conversation.push({ at: now, from: report.requester, role: "human", text: `Also reported via ${via}: ${report.title}${report.body ? `\n\n${report.body}` : ""}`.trim(), ...(report.attachments?.length ? { attachments: report.attachments } : {}) });
      w.attachments = [...(w.attachments ?? []), ...(report.attachments ?? [])].filter((a, i, all) => all.findIndex((b) => b.key === a.key) === i);
      const isSame = (s: Source) => s.provider === report.source.provider && s.url === report.source.url && s.channel === report.source.channel && s.thread === report.source.thread && s.issueId === report.source.issueId && s.number === report.source.number;
      if (!isSame(w.source) && !(w.linkedSources ?? []).some(isSame)) w.linkedSources = [...(w.linkedSources ?? []), report.source];
      w.correlationKeys = [...new Set([...(w.correlationKeys ?? []), ...correlationKeys(report)])];
      w.duplicates = [...(w.duplicates ?? []), { at: now, requester: report.requester, source: report.source, title: report.title, reason: match.reason, score: match.score, ...(duplicateId ? { workItemId: duplicateId } : {}) }];
    })!;
    this.k.audit(report.requester, "work_item.deduplicated", targetId, { via: report.source.provider, reason: match.reason, score: match.score, key: match.key, duplicate: duplicateId });
    return updated;
  }
}
