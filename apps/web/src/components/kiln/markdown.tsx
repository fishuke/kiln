import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** Markdown from agents, specs and people, rendered safely (raw HTML is escaped). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return <div className={cn("markdown", className)} dangerouslySetInnerHTML={{ __html: renderMarkdown(children) }} />;
}
