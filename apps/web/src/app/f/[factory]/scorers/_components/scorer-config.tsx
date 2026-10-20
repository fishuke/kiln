"use client";

import { useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { Field, SliderField, TokenPicker } from "@/components/kiln/form-controls";
import { MarkdownEditor } from "@/components/kiln/markdown-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Resources } from "@/lib/api/resources";
import { canSelfImprove, type ScorerLabel, type ScorerModel } from "@/lib/scorers";
import { cn } from "@/lib/utils";

const DEFAULT_RUNNER = "__default__";

function ClassificationDialog({ label, threshold, onSave, onClose, taken }: { label: ScorerLabel | null; threshold: number; onSave: (l: ScorerLabel) => void; onClose: () => void; taken: string[] }) {
  const [value, setValue] = useState(label?.value ?? "");
  const [description, setDescription] = useState(label?.description ?? "");
  const [score, setScore] = useState(label ? label.score.toFixed(2) : "");
  const n = Number(score);
  const scoreOk = score.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1;
  const nameOk = value.trim() !== "" && !taken.includes(value.trim());
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[672px]">
        <DialogHeader>
          <DialogTitle>{label ? "Edit classification" : "Add classification"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && scoreOk) onSave({ value: value.trim(), score: n, ...(description.trim() ? { description: description.trim() } : {}) });
          }}
        >
          <Field label="Classification name" required htmlFor="cl-name" error={value.trim() && !nameOk ? "Another classification already uses this name." : undefined}>
            <Input id="cl-name" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="E.g. “Adequate test coverage”" className="h-10" />
          </Field>
          <Field
            label="Classification criteria"
            htmlFor="cl-desc"
            help="Describe the measurable conditions that should trigger this outcome. Be specific enough that the scorer can consistently determine whether an agent's run meets the criteria."
          >
            <Textarea id="cl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="E.g. “At least 90% of new functions have tests.”" className="min-h-28" />
          </Field>
          <Field
            label="Classification score"
            required
            htmlFor="cl-score"
            help={`Choose the numerical score that should be applied for this classification. Your current pass threshold is a score of ${threshold.toFixed(2)}`}
            error={score && !scoreOk ? "Use a number from 0 to 1." : undefined}
          >
            <Input id="cl-score" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} placeholder="E.g. “1.00” for pass" className="h-10" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!nameOk || !scoreOk}>
              Save classification
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResourceRow({ label, info, children, source }: { label: string; info?: string; children: React.ReactNode; source: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 px-4 py-3">
      <span className="flex items-center gap-1 text-sm">
        {label}
        {info && (
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-60">{info}</TooltipContent>
          </Tooltip>
        )}
      </span>
      <div className="min-w-0">{children}</div>
      <span className="text-xs text-muted-foreground">{source}</span>
    </div>
  );
}

export function ScorerConfig({ model, onChange, res, errors, isNew }: { model: ScorerModel; onChange: (m: ScorerModel) => void; res: Resources; errors: Partial<Record<string, string>>; isNew?: boolean }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [customSecrets, setCustomSecrets] = useState(Boolean(model.secrets?.length));
  const [customMcps, setCustomMcps] = useState(Boolean(model.mcpServers?.length));
  const set = (patch: Partial<ScorerModel>) => onChange({ ...model, ...patch });
  const remaining = res.agents.filter((a) => !model.agents.some((x) => x.name === a.name));
  const typeOf = (name: string) => res.agents.find((a) => a.name === name)?.agentType;
  const selfOk = canSelfImprove(model);
  const labels = [...model.labels].map((l, i) => ({ l, i })).sort((a, b) => b.l.score - a.l.score);

  return (
    <div className="space-y-8">
      <Field label="Agent(s) to evaluate" required help="Select the agents you’d like this scorer to apply to." error={errors.agents}>
        <div className="rounded-xl border">
          {model.agents.length > 0 && (
            <ul className="space-y-1 p-3 pb-1">
              {model.agents.map((a, i) => (
                <li key={a.name} className="flex items-center gap-2 py-1">
                  <AgentTypeIcon type={typeOf(a.name)} />
                  <span className="flex-1 text-base">{a.name}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={a.includeDescendants} onCheckedChange={(v) => set({ agents: model.agents.map((x, j) => (j === i ? { ...x, includeDescendants: Boolean(v) } : x)) })} aria-label={`Include subagent runs of ${a.name}`} />
                    Include subagent runs
                  </label>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a.name}`} className="text-muted-foreground" onClick={() => set({ agents: model.agents.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className={cn("px-3", model.agents.length > 0 && "mx-3 border-t px-0")}>
            <DropdownMenu>
              <DropdownMenuTrigger disabled={!remaining.length} className="flex w-full items-center gap-2 py-3 text-left text-base text-foreground/80 outline-none disabled:text-muted-foreground/60">
                <Plus className="size-4" /> Add agent
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                {remaining.map((a) => (
                  <DropdownMenuItem key={a.name} onClick={() => set({ agents: [...model.agents, { name: a.name, includeDescendants: false }] })}>
                    <AgentTypeIcon type={a.agentType} /> {a.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Field>

      <Field label="Judge instructions" required help="Give the scorer specific instructions on how it should evaluate the agents." error={errors.rubric}>
        <MarkdownEditor label="Judge instructions" value={model.rubric} onChange={(rubric) => set({ rubric })} minHeight={160} placeholder="E.g. “You should look specifically for how many tests are being created for new functions”" invalid={Boolean(errors.rubric)} />
      </Field>

      <Field label="Judge model" required help="The model this scorer's judge runs on." error={errors.model}>
        <Select value={model.model} onValueChange={(v) => set({ model: String(v) })}>
          <SelectTrigger aria-label="Judge model" className="h-10 w-full text-base">
            <SelectValue>{(v: string) => v || <span className="text-muted-foreground">Choose a model</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...new Set([...(model.model ? [model.model] : []), ...res.models])].map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
            {res.routers.map((r) => (
              <SelectItem key={`router:${r}`} value={r}>
                {r} (router)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Judge resources" help="Values resolve from Factory agent defaults → scorer defaults → this scorer.">
        <div className="divide-y rounded-xl border">
          <ResourceRow label="Runner" info="The runner the hidden judge agent uses." source={model.runner ? "This scorer" : "From Agent defaults"}>
            <Select value={model.runner ?? DEFAULT_RUNNER} onValueChange={(v) => set({ runner: v === DEFAULT_RUNNER ? undefined : String(v) })}>
              <SelectTrigger aria-label="Runner" className="h-8 w-56">
                <SelectValue>{(v: string) => (v === DEFAULT_RUNNER ? "default" : v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_RUNNER}>default</SelectItem>
                {res.runners.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ResourceRow>
          <ResourceRow label="Secrets" source={customSecrets ? "This scorer" : "From Agent defaults"}>
            {customSecrets ? (
              <TokenPicker label="Judge secrets" values={model.secrets ?? []} onChange={(secrets) => set({ secrets })} suggestions={res.secrets} placeholder="select secrets" />
            ) : (
              <span className="flex items-center gap-3 text-sm text-muted-foreground">
                --
                <button type="button" className="font-medium text-violet-600 hover:underline dark:text-violet-400" onClick={() => setCustomSecrets(true)}>
                  Customize
                </button>
              </span>
            )}
          </ResourceRow>
          <ResourceRow label="MCPs" source={customMcps ? "This scorer" : "From Agent defaults"}>
            {customMcps ? (
              <TokenPicker label="Judge MCP servers" values={model.mcpServers ?? []} onChange={(mcpServers) => set({ mcpServers })} suggestions={res.mcpServers.map((m) => m.name)} placeholder="select MCP servers" />
            ) : (
              <span className="flex items-center gap-3 text-sm text-muted-foreground">
                --
                <button type="button" className="font-medium text-violet-600 hover:underline dark:text-violet-400" onClick={() => setCustomMcps(true)}>
                  Customize
                </button>
              </span>
            )}
          </ResourceRow>
        </div>
      </Field>

      <Field label="Classifications" required help="Define specific criteria that should result in the agent receiving either a passing or failing score." error={errors.labels}>
        <div className="rounded-xl border p-2">
          <ul className="space-y-1.5">
            {labels.map(({ l, i }) => {
              const pass = l.score >= model.passingScore;
              return (
                <li key={l.value} className={cn("group flex items-center gap-3 rounded-lg px-3 py-2.5", pass ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/30")}>
                  <button type="button" onClick={() => setEditing(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="min-w-9 rounded-md border bg-background px-1.5 py-0.5 text-center text-xs font-medium tabular-nums">{Number(l.score.toFixed(2))}</span>
                    <span className="min-w-0">
                      <span className="block text-base">
                        {l.value}
                        <span className="sr-only">{pass ? ", passes current threshold" : ", fails current threshold"}</span>
                      </span>
                      {l.description && <span className="block truncate text-sm text-muted-foreground">{l.description}</span>}
                    </span>
                  </button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.value}`} className="text-muted-foreground" onClick={() => set({ labels: model.labels.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setEditing("new")} disabled={model.labels.length >= 20} className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-base text-foreground/80 hover:bg-muted/50 disabled:text-muted-foreground/60">
            <Plus className="size-4" /> Add classification
          </button>
        </div>
      </Field>

      <Field label="Pass threshold" required help="Set a score threshold for what counts as a pass (0 to 1)." error={errors.passingScore}>
        <SliderField label="Pass threshold" value={model.passingScore} onChange={(passingScore) => set({ passingScore, selfImprovement: model.selfImprovement && canSelfImprove({ labels: model.labels, passingScore }) })} min={0} max={1} step={0.01} decimals={2} />
      </Field>

      <Field label="Sample rate" required help="Select how frequently this scorer should run across eligible agent runs." error={errors.samplingRate}>
        <SliderField label="Sample rate" value={model.samplingRate} onChange={(samplingRate) => set({ samplingRate })} min={0} max={100} step={1} suffix="%" />
      </Field>

      <div className="rounded-xl bg-muted/50 p-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <span>
            Self-improvement<span className="text-muted-foreground">*</span>
          </span>
          <Switch aria-label="Self-improvement" checked={model.selfImprovement && selfOk} disabled={!selfOk} onCheckedChange={(selfImprovement) => set({ selfImprovement })} />
        </label>
        <p className="mt-2 text-sm text-muted-foreground">When turned on, Self-improvement will analyze failing runs in order to suggest improvements to your factory.</p>
        {!selfOk && (
          <p className="mt-2 text-sm">
            <b>Self-improvement unavailable</b>: Add a classification below the pass threshold in order to enable self-improvement
          </p>
        )}
      </div>
      {isNew && <p className="text-xs text-muted-foreground">Saved as scorers/&lt;name&gt;/scorer.md in the factory definition.</p>}

      {editing !== null && (
        <ClassificationDialog
          label={editing === "new" ? null : model.labels[editing]!}
          threshold={model.passingScore}
          taken={model.labels.filter((_, j) => j !== editing).map((l) => l.value)}
          onClose={() => setEditing(null)}
          onSave={(l) => {
            set({ labels: editing === "new" ? [...model.labels, l] : model.labels.map((x, j) => (j === editing ? l : x)) });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
