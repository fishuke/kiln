import type { Kiln } from "./kiln";
import type { FactoryMetrics } from "./metrics";
import { C, newId, type Epic, type Gate, type Project, type Roadmap } from "./types";

export type PlanInput = { goal: string; prd?: string; notes?: string; factories: string[] };

export interface Planner {
  readonly name: string;
  plan(input: PlanInput): Promise<Omit<Epic, "id">[]>;
}

/**
 * Reads a PRD in Markdown: each `##` heading is an epic, each `###` heading or top-level bullet
 * an issue, and nested bullets or "AC:" lines its acceptance criteria. Used offline and in tests;
 * the PLAN agent does the same job with judgment.
 */
export class MarkdownPlanner implements Planner {
  readonly name = "markdown";

  async plan(input: PlanInput): Promise<Omit<Epic, "id">[]> {
    const text = [input.prd, input.notes].filter(Boolean).join("\n\n") || `## ${input.goal}\n- ${input.goal}`;
    const epics: Omit<Epic, "id">[] = [];
    let epic: Omit<Epic, "id"> | undefined;
    let issue: Epic["issues"][number] | undefined;
    const factory = input.factories[0] ?? "default";
    const factoryFor = (s: string) => input.factories.find((f) => s.toLowerCase().includes(`[${f}]`) || s.toLowerCase().includes(`@${f}`)) ?? factory;
    const clean = (s: string) => s.replace(/\s*\[[a-z0-9-]+\]\s*/gi, " ").replace(/\s*@[a-z0-9-]+/gi, "").trim();
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      const h2 = /^##\s+(.+)/.exec(line);
      const h3 = /^###\s+(.+)/.exec(line);
      const bullet = /^[-*]\s+(?:\[[ x]\]\s+)?(.+)/.exec(line);
      const nested = /^\s{2,}[-*]\s+(?:\[[ x]\]\s+)?(.+)/.exec(line);
      const ac = /^\s*(?:AC\d*|Acceptance)[:)]\s*(.+)/i.exec(line);
      const dep = /^\s*depends on:\s*(.+)/i.exec(line);
      if (h2 && !h3) {
        epic = { title: clean(h2[1]!), milestone: `M${epics.length + 1}`, dependsOn: [], issues: [] };
        epics.push(epic);
        issue = undefined;
      } else if (dep && epic) {
        epic.dependsOn = dep[1]!.split(",").map((d) => d.trim());
      } else if ((h3 || bullet) && !nested) {
        if (!epic) {
          epic = { title: clean(input.goal), milestone: "M1", dependsOn: [], issues: [] };
          epics.push(epic);
        }
        const title = (h3 ?? bullet)![1]!;
        issue = { title: clean(title), body: "", criteria: [], factory: factoryFor(title) };
        epic.issues.push(issue);
      } else if ((nested || ac) && issue) {
        issue.criteria.push(clean((nested ?? ac)![1]!));
      } else if (issue && line.trim()) {
        issue.body += `${line.trim()}\n`;
      }
    }
    for (const e of epics) {
      for (const i of e.issues) {
        if (!i.criteria.length) i.criteria = [`Given the change is deployed, when a user ${i.title.charAt(0).toLowerCase()}${i.title.slice(1)}, then it works as described and is covered by a test`];
        i.criteria = i.criteria.map((c, n) => (/^AC\d+/.test(c) ? c : `AC${n + 1}: ${c}`));
        i.body = i.body.trim() || i.title;
      }
    }
    return epics.filter((e) => e.issues.length);
  }
}

/** Runs the factory's PLAN agent; its result.json carries the epics. */
export class AgentPlanner implements Planner {
  readonly name = "agent";

  constructor(
    private readonly k: Kiln,
    private readonly factory: string,
  ) {}

  async plan(input: PlanInput): Promise<Omit<Epic, "id">[]> {
    const resolved = this.k.defs.current(this.factory);
    const agent = Object.values(resolved.agents).find((a) => a.agentType === "PLAN");
    if (!agent) return new MarkdownPlanner().plan(input);
    const run = await this.k.runs.execute({
      factory: this.factory,
      sha: this.k.defs.require(this.factory).appliedSha!,
      agent: agent.name,
      kind: "planner",
      prompt: [`Goal: ${input.goal}`, input.prd ? `PRD:\n${input.prd}` : "", input.notes ? `Notes:\n${input.notes}` : "", `Target factories: ${input.factories.join(", ")}`].filter(Boolean).join("\n\n"),
      push: false,
    });
    const epics = run.result?.epics as Omit<Epic, "id">[] | undefined;
    return epics?.length ? epics : new MarkdownPlanner().plan(input);
  }
}

export class PlanningService {
  constructor(private readonly k: Kiln) {}

  projects(): Project[] {
    return this.k.store.list<Project>(C.projects).sort((a, b) => a.name.localeCompare(b.name));
  }

  project(id: string) {
    return this.k.store.get<Project>(C.projects, id);
  }

  createProject(input: { name: string; owner: string; factories: string[] }): Project {
    const p: Project = { id: newId("proj"), name: input.name, owner: input.owner, factories: input.factories, createdAt: this.k.clock.now().toISOString() };
    this.k.store.put(C.projects, p);
    for (const f of input.factories) {
      const b = this.k.defs.get(f);
      if (b) this.k.store.put(C.factories, { ...b, projectId: p.id });
    }
    this.k.audit(input.owner, "project.created", p.id, input);
    return p;
  }

  roadmap(id: string) {
    return this.k.store.get<Roadmap>(C.roadmaps, id);
  }

  /** Goal or PRD → roadmap → tracker issues with acceptance criteria and a target factory. */
  async plan(projectId: string, input: Omit<PlanInput, "factories"> & { createIssues?: boolean; by: string }): Promise<Roadmap> {
    const project = this.project(projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    const planner = this.k.planner ?? (project.factories[0] ? new AgentPlanner(this.k, project.factories[0]) : new MarkdownPlanner());
    const epics = (await planner.plan({ ...input, factories: project.factories })).map((e) => ({ ...e, id: newId("epic") }));
    const roadmap: Roadmap = { id: newId("road"), projectId, goal: input.goal, epics, createdAt: this.k.clock.now().toISOString() };
    if (input.createIssues !== false && this.k.tracker) {
      for (const epic of roadmap.epics) {
        const parent = await this.k.tracker.createIssue({ title: epic.title, body: `${input.goal}\n\nMilestone ${epic.milestone}${epic.dependsOn.length ? `\nDepends on: ${epic.dependsOn.join(", ")}` : ""}`, labels: ["epic"] });
        epic.trackerKey = parent.key;
        epic.url = parent.url;
        for (const issue of epic.issues) {
          const alias = this.k.defs.get(issue.factory)?.alias ?? issue.factory;
          const created = await this.k.tracker.createIssue({
            title: issue.title,
            body: `${issue.body}\n\n## Acceptance criteria\n${issue.criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\nFactory: @${alias}`,
            labels: [`factory:${alias}`],
            parentId: parent.id,
          });
          issue.trackerKey = created.key;
          issue.url = created.url;
        }
      }
    }
    this.k.store.put(C.roadmaps, roadmap);
    this.k.store.put(C.projects, { ...project, roadmapId: roadmap.id });
    this.k.audit(input.by, "roadmap.created", roadmap.id, { epics: epics.length, issues: epics.reduce((s, e) => s + e.issues.length, 0) });
    return roadmap;
  }

  /** Cross-factory rollup for the portfolio view. */
  portfolio(since?: string) {
    const factories = this.k.defs.list();
    const metrics = Object.fromEntries(factories.map((f) => [f.id, this.k.metrics.factory(f.id, { since })])) as Record<string, FactoryMetrics>;
    const sum = (ids: string[], pick: (m: FactoryMetrics) => number) => Math.round(ids.reduce((s, id) => s + (metrics[id] ? pick(metrics[id]!) : 0), 0) * 100) / 100;
    const projects = this.projects().map((p) => ({
      project: p,
      factories: p.factories.map((f) => metrics[f]).filter(Boolean),
      totals: {
        prsOpened: sum(p.factories, (m) => m.prsOpened),
        prsMerged: sum(p.factories, (m) => m.prsMerged),
        costUsd: sum(p.factories, (m) => m.costUsd),
        activeWorkItems: sum(p.factories, (m) => m.workItems.active),
        pendingDecisions: this.k.gates.list({ state: "open" }).filter((g) => p.factories.includes(g.factory)).length,
      },
    }));
    const all = factories.map((f) => f.id);
    return { projects, totals: { factories: all.length, prsMerged: sum(all, (m) => m.prsMerged), costUsd: sum(all, (m) => m.costUsd), activeWorkItems: sum(all, (m) => m.workItems.active) } };
  }

  /** Weekly digest per person: the decisions waiting on them, with deep links. */
  digest(): { person: string; items: { gateId: string; title: string; ageHours: number; link: string; kind: Gate["kind"] }[]; text: string }[] {
    const now = this.k.clock.now().getTime();
    const byPerson = new Map<string, Gate[]>();
    for (const g of this.k.gates.list({ state: "open" })) for (const p of g.assignees) byPerson.set(p, [...(byPerson.get(p) ?? []), g]);
    return [...byPerson.entries()].map(([person, gates]) => {
      const items = gates
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
        .map((g) => ({ gateId: g.id, title: g.title, kind: g.kind, ageHours: Math.round((now - new Date(g.openedAt).getTime()) / 3_600_000), link: this.k.link(`/inbox/${g.id}`) }));
      const text = [`${items.length} decision(s) waiting on you:`, ...items.map((i) => `- ${i.title} (${i.ageHours}h) ${i.link}`)].join("\n");
      return { person, items, text };
    });
  }
}
