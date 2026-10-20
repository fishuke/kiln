import { diffTrees, validateTree } from "@kiln/definitions";
import { KilnError } from "./errors";
import type { Kiln } from "./kiln";
import { C, newId, type DefinitionChange } from "./types";

/**
 * Definition changes proposed by agents (or people) for review: they show up in the inbox as
 * spec reviews with a diff. "Approve & merge" applies them (or opens the config-repo PR);
 * "Request changes" sends the comments back to the agent that proposed them.
 */
export class DefinitionChangeService {
  constructor(private readonly k: Kiln) {}

  get(id: string) {
    return this.k.store.get<DefinitionChange>(C.definitionChanges, id);
  }

  require(id: string) {
    const c = this.get(id);
    if (!c) throw new KilnError("resource_not_found", `unknown definition change ${id}`);
    return c;
  }

  list(filter: { factory?: string; state?: DefinitionChange["state"] } = {}) {
    return this.k.store
      .list<DefinitionChange>(C.definitionChanges, (c) => (!filter.factory || c.factory === filter.factory) && (!filter.state || c.state === filter.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  propose(input: { factory: string; title: string; message?: string; files: Record<string, string | null>; by: string; runId?: string; workItemId?: string }): DefinitionChange {
    const before = this.k.editor.tree(input.factory);
    const after = { ...before };
    for (const [p, c] of Object.entries(input.files)) {
      if (c === null) delete after[p];
      else after[p] = c;
    }
    const v = validateTree(after);
    if (!v.ok) throw new KilnError("invalid_request", `the proposed definition is invalid:\n${v.errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join("\n")}`);
    const change: DefinitionChange = {
      id: newId("defchg"),
      factory: input.factory,
      title: input.title.slice(0, 200),
      message: input.message ?? "",
      files: input.files,
      diff: diffTrees(before, after),
      patches: Object.entries(input.files).map(([path, c]) => ({ path, ...(before[path] !== undefined ? { before: before[path] } : {}), ...(c !== null ? { after: c } : {}) })),
      proposedBy: input.by,
      runId: input.runId,
      workItemId: input.workItemId,
      state: "open",
      comments: [],
      createdAt: this.k.clock.now().toISOString(),
    };
    this.k.store.put(C.definitionChanges, change);
    this.k.audit(input.by, "definition_change.proposed", change.id, { factory: input.factory, paths: Object.keys(input.files) });
    return change;
  }

  comment(id: string, by: string, input: { text: string; path?: string; line?: number }) {
    const c = this.require(id);
    const next = { ...c, comments: [...c.comments, { at: this.k.clock.now().toISOString(), by, ...input }] };
    this.k.store.put(C.definitionChanges, next);
    return next;
  }

  /** Approve & merge. Agents never approve their own (or any) definition change. */
  async approve(id: string, by: string): Promise<DefinitionChange> {
    const c = this.require(id);
    if (c.state !== "open" && c.state !== "changes_requested") throw new KilnError("conflict", `definition change ${id} is ${c.state}`);
    if (by.startsWith("agent:") || by.startsWith("kiln-agent")) throw new KilnError("not_authorized", "agents cannot approve definition changes");
    const r = await this.k.editor.write(c.factory, c.files, { message: `${c.title}\n\n${c.message}`.trim(), by });
    const now = this.k.clock.now().toISOString();
    if (!r.ok) {
      const failed = { ...c, errors: r.errors };
      this.k.store.put(C.definitionChanges, failed);
      throw new KilnError("invalid_request", `the change no longer applies:\n${r.errors.join("\n")}`);
    }
    const next: DefinitionChange = { ...c, state: "merged", decidedAt: now, decidedBy: by, result: r.mode === "pull_request" ? { prUrl: r.prUrl } : r.mode === "applied" ? { sha: r.sha } : {} };
    this.k.store.put(C.definitionChanges, next);
    this.k.audit(by, "definition_change.merged", id, next.result);
    if (c.workItemId) this.k.workflow.touch(c.workItemId, by, `approved the definition change "${c.title}"`);
    return next;
  }

  /** Request changes: the comments go back to the proposing agent as a follow-up. */
  async requestChanges(id: string, by: string, text: string): Promise<DefinitionChange> {
    const c = this.comment(id, by, { text });
    const next: DefinitionChange = { ...c, state: "changes_requested", decidedAt: this.k.clock.now().toISOString(), decidedBy: by };
    this.k.store.put(C.definitionChanges, next);
    const feedback = [`Changes requested on your definition change "${c.title}":`, ...c.comments.map((m) => `- ${m.path ? `${m.path}${m.line ? `:${m.line}` : ""}: ` : ""}${m.text}`)].join("\n");
    if (c.runId && this.k.runs.get(c.runId)) await this.k.runs.followup(c.runId, { message: feedback, by }).catch(() => undefined);
    else if (c.workItemId) this.k.workflow.addMessage(c.workItemId, by, feedback);
    this.k.audit(by, "definition_change.changes_requested", id);
    return next;
  }

  reject(id: string, by: string): DefinitionChange {
    const c = this.require(id);
    const next: DefinitionChange = { ...c, state: "rejected", decidedAt: this.k.clock.now().toISOString(), decidedBy: by };
    this.k.store.put(C.definitionChanges, next);
    this.k.audit(by, "definition_change.rejected", id);
    return next;
  }
}
