import type { Chat, Mailer } from "@kiln/integrations";
import type { Kiln } from "../kiln";
import type { Gate, WorkItem } from "../types";
import { defaultNotifications } from "./users";
import { DEFAULT_DIGEST, type InboxKind, type NotifyChannel, type User } from "./types";

/** One delivery attempt, kept for dedupe and for "why didn't I get a message?". */
export type NotificationRecord = {
  id: string;
  userId: string;
  kind: InboxKind | "digest";
  ref: string;
  channel: NotifyChannel;
  status: "sent" | "failed" | "skipped";
  error?: string;
  at: string;
};

const COLLECTION = "notifications";

type Notice = { kind: InboxKind; ref: string; subject: string; text: string };

const KIND_LABEL: Record<InboxKind, string> = {
  spec: "Spec to approve",
  preview: "Preview to accept",
  question: "Question for you",
  merge: "Pull request to review",
  custom: "Decision needed",
  blocked: "Work is blocked",
  failed: "Work failed",
};

/**
 * Tells people about new inbox items (gates and questions), and about their work being blocked or
 * failing: by email, and by direct message in Slack or Discord when they linked that account. Each
 * person's preferences decide the channels per kind; a daily digest can replace or add to them.
 */
export class NotificationService {
  constructor(private readonly k: Kiln) {}

  /** Chat adapters by provider key ("slack", "discord"), from `chats` or the main chat. */
  chats(): Partial<Record<"slack" | "discord", Chat>> {
    const fromMain = this.k.chat && this.k.chat.name !== "fake" ? { [this.k.chat.name]: this.k.chat } : {};
    return { ...fromMain, ...this.k.options.adapters?.chats, ...this.k.options.chats };
  }

  get mailer(): Mailer | undefined {
    return this.k.options.mailer;
  }

  /** Wire to the event bus. Called once by the Kiln constructor. */
  subscribe() {
    this.k.bus.subscribe("gate.opened", async (e) => {
      const gate = this.k.gates.get(e.payload.gateId);
      if (gate) await this.onGate(gate);
    });
    this.k.bus.subscribe("work_item.stage_changed", async (e) => {
      if (e.payload.to !== "blocked" && e.payload.to !== "failed") return;
      const wi = this.k.workflow.get(e.payload.workItemId);
      if (wi) await this.onStuck(wi, e.payload.to, e.payload.reason);
    });
  }

  async onGate(gate: Gate) {
    const kind = (["spec", "preview", "question", "merge", "custom"] as const).includes(gate.kind as never) ? (gate.kind as InboxKind) : "custom";
    const wi = this.k.workflow.get(gate.workItemId);
    const link = this.k.link(`/inbox/${gate.id}`);
    const lines = [gate.question ?? gate.title, wi ? `Work item: ${wi.title} (${gate.factory})` : "", ...gate.evidence.map((e) => `${e.label}: ${e.url}`), "", `Decide: ${link}`].filter((l, i) => l || i > 1);
    await this.deliver(gate.assignees, { kind, ref: gate.id, subject: `${KIND_LABEL[kind]}: ${gate.title}`, text: lines.join("\n") });
  }

  async onStuck(wi: WorkItem, kind: "blocked" | "failed", reason: string) {
    const text = [`${wi.title} (${wi.factory}) is ${kind}.`, reason || wi.blockedReason || "", "", `Open: ${this.k.link(`/f/${encodeURIComponent(wi.factory)}?workItem=${wi.id}`)}`].join("\n");
    await this.deliver([wi.requester], { kind, ref: `${wi.id}:${kind}:${wi.updatedAt}`, subject: `${KIND_LABEL[kind]}: ${wi.title}`, text });
  }

  private async deliver(people: string[], notice: Notice) {
    for (const person of [...new Set(people)]) {
      const user = this.k.users.byEmail(person);
      if (!user) continue;
      if ((user.digest ?? DEFAULT_DIGEST).daily && user.digest?.only) continue;
      const prefs = { ...defaultNotifications()[notice.kind], ...user.notifications?.[notice.kind] };
      for (const channel of ["email", "slack", "discord"] as const) {
        if (!prefs[channel]) continue;
        await this.send(user, channel, notice.kind, notice.ref, notice.subject, notice.text);
      }
    }
  }

  private async send(user: User, channel: NotifyChannel, kind: NotificationRecord["kind"], ref: string, subject: string, text: string) {
    const id = `${user.id}:${kind}:${ref}:${channel}`;
    if (this.k.store.get<NotificationRecord>(COLLECTION, id)?.status === "sent") return;
    const record = (status: NotificationRecord["status"], error?: string) =>
      this.k.store.put<NotificationRecord>(COLLECTION, { id, userId: user.id, kind, ref, channel, status, error, at: this.k.clock.now().toISOString() });
    try {
      if (channel === "email") {
        if (!this.mailer) return;
        await this.mailer.send({ to: user.email, subject, text });
      } else {
        const chat = this.chats()[channel];
        const account = user.linkedAccounts.find((a) => a.provider === channel);
        if (!chat || !account) return;
        const message = `*${subject}*\n${text}`;
        // Direct message: Slack conversations.open, Discord DM channels; else post to the user id.
        if (chat.directMessage) await chat.directMessage(account.externalId, message);
        else await chat.post({ channel: account.externalId, text: message });
      }
      record("sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record("failed", message);
      this.k.audit("kiln", "notify.failed", user.id, { channel, kind, ref, error: message });
    }
  }

  /** Recent deliveries for one user, newest first. */
  history(userId: string, limit = 50): NotificationRecord[] {
    return this.k.store
      .list<NotificationRecord>(COLLECTION, (n) => n.userId === userId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  /** Daily digests, from the timer pass: once a day per user, at or after their hour (UTC). */
  async tick() {
    const now = this.k.clock.now();
    const day = now.toISOString().slice(0, 10);
    const digests = new Map(this.k.planning.digest().map((d) => [d.person, d]));
    for (const user of this.k.users.list()) {
      const prefs = { ...DEFAULT_DIGEST, ...user.digest };
      if (!prefs.daily || now.getUTCHours() < prefs.hourUtc) continue;
      const d = digests.get(user.email);
      if (!d || d.items.length === 0) continue;
      for (const channel of prefs.channels) await this.send(user, channel, "digest", day, `Kiln: ${d.items.length} decision(s) waiting on you`, d.text);
    }
  }
}
