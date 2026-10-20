import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { decideGate } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Pre, StateBadge } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import { timeAgo } from "@/lib/format";

export default async function GatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await safe(() => api.gate(id), null);
  if (!gate) notFound();
  const wi = gate.workItem;
  return (
    <>
      <PageHeader crumbs={[{ label: "Inbox", href: "/inbox" }, { label: gate.title }]} />
      <Page narrow>
        <h1 className="text-xl font-semibold">{gate.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {gate.kind} · {gate.factory} · opened {timeAgo(gate.openedAt)} · for {gate.assignees.join(", ") || "anyone"}
          {gate.expireAt && ` · expires ${new Date(gate.expireAt).toLocaleString()} (${gate.expireAction})`}
        </p>
        {wi && (
          <Link href={`/runs/${wi.id}`} className="mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm hover:bg-muted/50">
            <span className="truncate font-medium">{wi.title}</span>
            <span className="ml-auto">
              <StateBadge state={wi.state} />
            </span>
          </Link>
        )}
        {gate.command && (
          <div className="mt-4 text-sm">
            The guardrail stopped this command and asks whether to run it:
            <Pre className="mt-2">{gate.command}</Pre>
          </div>
        )}
        {gate.question && !gate.command && <Pre className="mt-4 font-sans text-sm">{gate.question}</Pre>}
        {gate.evidence.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {gate.evidence.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                {e.label} <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        )}
        {gate.state === "open" ? (
          <form action={decideGate} className="mt-6 space-y-3">
            <input type="hidden" name="gateId" value={gate.id} />
            <input type="hidden" name="back" value="/inbox" />
            <textarea name="answer" rows={3} placeholder={gate.kind === "question" ? "Your answer" : "Optional note; with Request changes it goes to the agents"} className="w-full rounded-md border bg-background p-3 text-sm" />
            <div className="flex gap-2">
              {gate.kind === "question" && !gate.command ? (
                <SubmitButton name="decision" value="answer">Answer</SubmitButton>
              ) : (
                <SubmitButton name="decision" value="approve">{gate.command ? "Run it" : gate.kind === "merge" ? "Confirm it landed" : "Approve"}</SubmitButton>
              )}
              <SubmitButton name="decision" value="reject" variant="outline">
                {gate.command ? "Block it" : gate.kind === "question" ? "Stop the work" : "Request changes"}
              </SubmitButton>
            </div>
          </form>
        ) : (
          <p className="mt-6 text-sm">
            {gate.state} by {gate.decidedBy} via {gate.decidedVia ?? "kiln"} {timeAgo(gate.decidedAt)}
            {gate.answer ? `: ${gate.answer}` : ""}
          </p>
        )}
      </Page>
    </>
  );
}
