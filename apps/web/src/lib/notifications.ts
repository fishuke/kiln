import type { NotificationPrefs } from "@kiln/sdk-ts";

/** What people can be notified about, in the order the settings page shows them. */
export const NOTIFICATION_KINDS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: "spec", label: "Spec approvals", hint: "A spec waits for your approval" },
  { key: "preview", label: "Preview reviews", hint: "A preview is ready to check" },
  { key: "question", label: "Questions", hint: "An agent asks you something" },
  { key: "merge", label: "Pull request reviews", hint: "A pull request is ready to review and merge" },
  { key: "custom", label: "Other requests", hint: "Custom gates from automations" },
  { key: "blocked", label: "Blocked work", hint: "Work you asked for is blocked" },
  { key: "failed", label: "Failed work", hint: "Work you asked for failed" },
];

export const NOTIFICATION_CHANNELS = [
  ["email", "Email"],
  ["slack", "Slack"],
  ["discord", "Discord"],
] as const;

/** Kinds an older account has no preference for yet default to every channel, as on the server. */
export function withDefaults(prefs: Partial<NotificationPrefs> | undefined): NotificationPrefs {
  const all = { email: true, slack: true, discord: true };
  return Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k.key, { ...all, ...prefs?.[k.key] }])) as NotificationPrefs;
}

export function notificationLabel(kind: string): string {
  return kind === "digest" ? "Daily digest" : (NOTIFICATION_KINDS.find((k) => k.key === kind)?.label ?? kind);
}
