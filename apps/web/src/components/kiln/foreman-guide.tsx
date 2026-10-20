"use client";

import { AtSign, Copy, MessageCircle, Tag, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Line = { icon: React.ComponentType<{ className?: string }>; before: string; handle: string; after: string; copyLabel: string };
type Section = { app: string; lines: Line[] };

/** How people reach the factory foreman from connected apps. Handles are Kiln's, labels use the factory alias. */
export function foremanSections(alias: string): Section[] {
  const label = `factory:${alias}`;
  return [
    {
      app: "Slack",
      lines: [
        { icon: AtSign, before: "Mention ", handle: "@Kiln", after: " in a channel or thread", copyLabel: "Copy Slack mention" },
        { icon: MessageCircle, before: "Send ", handle: "@Kiln", after: " a direct message", copyLabel: "Copy Slack handle" },
      ],
    },
    { app: "Discord", lines: [{ icon: AtSign, before: "Mention ", handle: "@Kiln", after: " in a channel or thread", copyLabel: "Copy Discord mention" }] },
    {
      app: "Linear",
      lines: [
        { icon: User, before: "Assign ", handle: "@Kiln", after: "", copyLabel: "Copy Linear assignee" },
        { icon: MessageCircle, before: "Mention ", handle: "@Kiln", after: " in a comment", copyLabel: "Copy Linear mention" },
      ],
    },
    {
      app: "Jira",
      lines: [
        { icon: User, before: "Assign ", handle: "Kiln", after: "", copyLabel: "Copy Jira assignee" },
        { icon: MessageCircle, before: "Mention ", handle: "@Kiln", after: " in a comment", copyLabel: "Copy Jira mention" },
      ],
    },
    {
      app: "GitHub",
      lines: [
        { icon: Tag, before: "Add ", handle: label, after: " as a label to any issue or PR", copyLabel: "Copy GitHub label" },
        { icon: MessageCircle, before: "Mention ", handle: "@kiln-factory", after: " in a comment on any PR", copyLabel: "Copy GitHub mention" },
      ],
    },
    {
      app: "GitLab",
      lines: [
        { icon: Tag, before: "Add ", handle: label, after: " as a label to any issue or MR", copyLabel: "Copy GitLab label" },
        { icon: MessageCircle, before: "Mention ", handle: "@kiln-factory", after: " in a comment on any MR", copyLabel: "Copy GitLab mention" },
      ],
    },
  ];
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success(`Copied ${text}`),
    () => toast.error("Could not copy"),
  );
}

export function ForemanGuide({ alias, copyable = false, columns = 1 }: { alias: string; copyable?: boolean; columns?: 1 | 2 }) {
  const sections = foremanSections(alias);
  return (
    <div className={cn(columns === 2 ? "grid grid-cols-2 gap-x-6" : "flex flex-col")}>
      {sections.map((s, i) => (
        <div key={s.app} className={cn(i >= columns && "mt-3 border-t pt-3")}>
          <div className="mb-1.5 text-sm font-medium">{s.app}</div>
          <ul className="flex flex-col gap-1.5">
            {s.lines.map((l) => (
              <li key={l.copyLabel} className="group/line flex items-start gap-2.5 text-sm text-muted-foreground">
                <span className="mt-px flex size-[22px] shrink-0 items-center justify-center rounded-[4px] bg-muted">
                  <l.icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 leading-[22px]">
                  {l.before}
                  {copyable ? (
                    <button type="button" title={`${l.copyLabel} handle`} onClick={() => copy(l.handle)} className="font-medium text-foreground hover:underline">
                      {l.handle}
                    </button>
                  ) : (
                    <span className="font-medium text-foreground">{l.handle}</span>
                  )}
                  {l.after}
                </span>
                {copyable && (
                  <button type="button" aria-label={l.copyLabel} onClick={() => copy(l.handle)} className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover/line:opacity-100 hover:text-foreground focus-visible:opacity-100">
                    <Copy className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
