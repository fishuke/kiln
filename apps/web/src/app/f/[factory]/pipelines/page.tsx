import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, Bot, Clock, CornerUpLeft, FileCheck2, Layers, ShieldCheck, SkipForward, Sparkles, Zap } from "lucide-react";
import { Code, Empty, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Badge } from "@/components/ui/badge";
import { api, safe } from "@/lib/kiln";
import { AreaTabs } from "../automations/_components/area-tabs";

type Stage = {
  id: string;
  agent?: string;
  action?: string;
  gate?: string;
  skip_if?: string;
  fan_out?: string;
  requires?: string[];
  on_fail?: string;
  max_loops?: number;
  advisory?: boolean;
  fast_path?: boolean;
};
type Pipeline = { description?: string; stages: Stage[]; budget?: { maxUsd: number } };
type Gate = { kind: string; approvers: string[]; evidence?: string[]; nudge?: string; expire?: string; rule?: string };

const REQUIREMENT_LABELS: Record<string, string> = { ci_green: "CI green", criteria_videos: "criteria videos", tests_pass: "tests pass" };
const ACTION_LABELS: Record<string, string> = { "preview.deploy": "Deploy preview", handoff: "Hand off" };

export default async function Pipelines({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  const f = await safe(() => api.factory(factory), null);
  if (!f) notFound();
  const pipelines = Object.entries(f.pipelines) as [string, Pipeline][];
  const gates = Object.entries(f.gates) as [string, Gate][];
  const defaultName = f.definition.defaultPipeline;
  pipelines.sort(([a], [b]) => Number(b === defaultName) - Number(a === defaultName));
  const usedBy = (gate: string) => pipelines.flatMap(([p, pl]) => pl.stages.filter((s) => s.gate === gate).map((s) => `${p} › ${s.id}`));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: f.factory.name, href: `/f/${factory}/dashboard` },
          { label: "Automations", href: `/f/${factory}/automations` },
          { label: "Pipelines" },
        ]}
      />
      <div className="px-4 pt-6 sm:px-6">
        <AreaTabs factory={factory} active="pipelines" />
      </div>
      <Page>
        <p className="mb-8 max-w-3xl text-sm text-muted-foreground">
          A pipeline fixes the path a work item takes, with typed gates between stages. Without one, the foreman picks the shortest path: triage, spec (when
          needed, approved), build, verify, preview, review, hand-off. Pipelines live in{" "}
          <Link className="underline underline-offset-2 hover:text-foreground" href={`/f/${factory}/definition`}>
            <Code>pipelines/*.yaml</Code>
          </Link>
          .
        </p>

        {pipelines.length === 0 && <Empty title="Foreman-driven">This factory has no pipeline; the foreman chooses the path for each work item.</Empty>}

        {pipelines.map(([name, p]) => (
          <Section
            key={name}
            title={name}
            description={p.description}
            action={
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                {name === defaultName && <Badge variant="secondary">Default</Badge>}
                <span>{p.stages.length} stages</span>
                {p.budget && <span>· budget ${p.budget.maxUsd}</span>}
              </div>
            }
          >
            <ol className="relative">
              {p.stages.map((s, i) => (
                <StageRow key={s.id} stage={s} index={i} last={i === p.stages.length - 1} gate={s.gate ? (f.gates[s.gate] as Gate | undefined) : undefined} />
              ))}
            </ol>
          </Section>
        ))}

        {gates.length > 0 && (
          <Section title="Gates" description="Where a person decides before the work item moves on.">
            <div className="grid gap-3 md:grid-cols-2">
              {gates.map(([n, g]) => (
                <GateCard key={n} name={n} gate={g} usedBy={usedBy(n)} />
              ))}
            </div>
          </Section>
        )}
      </Page>
    </>
  );
}

function StageRow({ stage: s, index, last, gate }: { stage: Stage; index: number; last: boolean; gate?: Gate }) {
  const isAgent = Boolean(s.agent);
  const details: React.ReactNode[] = [];
  if (s.gate)
    details.push(
      <Detail key="gate" icon={<ShieldCheck className="text-amber-500" />}>
        Waits at gate{" "}
        <a href={`#gate-${s.gate}`} className="font-medium text-foreground underline-offset-2 hover:underline">
          {s.gate}
        </a>
        {gate && (
          <>
            {" "}
            · {gate.kind} by {gate.approvers.join(", ")}
          </>
        )}
      </Detail>,
    );
  if (s.requires?.length)
    details.push(
      <Detail key="req" icon={<FileCheck2 className="text-emerald-500" />}>
        Passes only when {s.requires.map((r) => REQUIREMENT_LABELS[r] ?? r).join(" and ")}
      </Detail>,
    );
  if (s.on_fail)
    details.push(
      <Detail key="fail" icon={<CornerUpLeft className="text-rose-500" />}>
        On failure, back to <span className="font-medium text-foreground">{s.on_fail}</span> (up to {s.max_loops ?? 3} times)
      </Detail>,
    );
  if (s.skip_if)
    details.push(
      <Detail key="skip" icon={<SkipForward />}>
        Skipped when <code className="break-words font-mono text-[11px] text-foreground/80">{s.skip_if}</code>
      </Detail>,
    );
  if (s.fan_out === "per_user_story")
    details.push(
      <Detail key="fan" icon={<Layers />}>
        Runs once per user story
      </Detail>,
    );
  if (s.advisory)
    details.push(
      <Detail key="adv" icon={<Sparkles />}>
        Advisory: findings never block
      </Detail>,
    );
  if (s.fast_path === false)
    details.push(
      <Detail key="fast" icon={<Bot />}>
        Always runs the agent, even on a confident triage
      </Detail>,
    );

  return (
    <li className="relative flex gap-4 pb-3 last:pb-0">
      {!last && <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-border" />}
      <span className="relative z-10 mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-xs text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 rounded-xl border bg-card p-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">{s.id}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {isAgent ? <Bot className="size-3.5" /> : <Zap className="size-3.5" />}
            {isAgent ? `agent ${s.agent}` : (ACTION_LABELS[s.action ?? ""] ?? s.action)}
          </span>
        </div>
        {details.length > 0 && <ul className="mt-2.5 space-y-1.5">{details}</ul>}
      </div>
    </li>
  );
}

function Detail({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs text-muted-foreground [&>span:first-child>svg]:size-3.5">
      <span className="mt-px shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function GateCard({ name, gate: g, usedBy }: { name: string; gate: Gate; usedBy: string[] }) {
  const [expireAfter, expireOutcome] = g.expire?.split(/\s*->\s*/) ?? [];
  const rows = [
    { icon: <ShieldCheck />, label: "Approvers", value: g.approvers.join(", ") },
    g.evidence?.length ? { icon: <FileCheck2 />, label: "Evidence", value: g.evidence.join(", ") } : null,
    g.nudge ? { icon: <Bell />, label: "Nudge", value: `after ${g.nudge}` } : null,
    expireAfter ? { icon: <Clock />, label: "Expires", value: `after ${expireAfter}${expireOutcome ? `, then ${expireOutcome}` : ""}` } : null,
    g.rule ? { icon: <Zap />, label: "Rule", value: <code className="font-mono text-[11px]">{g.rule}</code> } : null,
  ].filter((r) => r !== null);
  return (
    <div id={`gate-${name}`} className="scroll-mt-20 rounded-xl border bg-card p-4 target:ring-2 target:ring-ring">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <Badge variant="outline" className="capitalize">
          {g.kind}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_auto_1fr] items-start gap-x-2 gap-y-1.5 text-xs">
        {rows.map(({ icon, label, value }) => (
          <div key={label} className="contents">
            <dt className="mt-px text-muted-foreground [&>svg]:size-3.5">{icon}</dt>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">
        {usedBy.length ? <>Used by {usedBy.join(", ")}</> : "Not used by any pipeline stage"}
      </div>
    </div>
  );
}
