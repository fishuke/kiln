"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field } from "@/components/kiln/form-controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BenchConfig } from "@/lib/benchmarks";
import type { RunSettings } from "../actions";

const INHERIT = "__inherit__";
type Row = { name: string; harness: string; model: string; runner: string };

function toRow(c: BenchConfig, agent: string): Row {
  const a = c.agents?.find((x) => x.agent === agent) ?? c.agents?.[0];
  return { name: c.name, harness: a?.harness?.type ?? INHERIT, model: a?.model ?? a?.harness?.model ?? INHERIT, runner: c.runner ?? INHERIT };
}

function fromRow(r: Row, agent: string): BenchConfig {
  const harness = r.harness !== INHERIT ? { type: r.harness, ...(r.model !== INHERIT ? { model: r.model } : {}) } : undefined;
  const entry = harness ? { agent, harness } : r.model !== INHERIT ? { agent, model: r.model } : undefined;
  return { name: r.name.trim(), ...(entry ? { agents: [entry] } : {}), ...(r.runner !== INHERIT ? { runner: r.runner } : {}) };
}

function Pick({ label, value, options, onChange, inherit }: { label: string; value: string; options: string[]; onChange: (v: string) => void; inherit: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v))}>
      <SelectTrigger aria-label={label} className="h-9 w-full">
        <SelectValue>{(v: string) => (v === INHERIT ? <span className="text-muted-foreground">{inherit}</span> : v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inherit}</SelectItem>
        {[...new Set([...(value !== INHERIT ? [value] : []), ...options])].map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Configurations (harness, model or router, runner), scorers, repetitions and the resulting trial count. */
export function RunDialog({
  open,
  onClose,
  onRun,
  pending,
  agent,
  configurations,
  tasks,
  models,
  routers,
  harnesses,
  runners,
  scorers,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (s: RunSettings) => void;
  pending: boolean;
  agent: string;
  configurations: BenchConfig[];
  tasks: number;
  models: string[];
  routers: string[];
  harnesses: string[];
  runners: string[];
  scorers: string[];
}) {
  const [rows, setRows] = useState<Row[]>(() => (configurations.length ? configurations : [{ name: "Baseline" }]).map((c) => toRow(c, agent)));
  const [picked, setPicked] = useState<string[]>(["correctness"]);
  const [reps, setReps] = useState(1);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const names = rows.map((r) => r.name.trim());
  const problem = names.some((n) => !n) ? "Name every configuration." : new Set(names).size !== names.length ? "Configuration names must be unique." : null;
  const trials = rows.length * tasks * reps;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Run benchmark</DialogTitle>
          <DialogDescription>Each configuration runs every task. Runs freeze their inputs, so results stay comparable.</DialogDescription>
        </DialogHeader>
        <Field label="Configurations" help="Choose a harness and model, or a router, plus the runner. Up to six.">
          <div className="space-y-2">
            <div className="grid grid-cols-[1.2fr_1fr_1.3fr_1fr_auto] gap-2 px-1 text-xs text-muted-foreground">
              <span>Name</span>
              <span>Harness</span>
              <span>Model or router</span>
              <span>Runner</span>
              <span className="w-7" />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.2fr_1fr_1.3fr_1fr_auto] items-center gap-2">
                <Input aria-label={`Configuration ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-9" />
                <Pick label="Harness" value={r.harness} options={harnesses} onChange={(harness) => set(i, { harness })} inherit="Agent's" />
                <Pick label="Model" value={r.model} options={[...models, ...routers]} onChange={(model) => set(i, { model })} inherit="Agent's" />
                <Pick label="Runner" value={r.runner} options={runners} onChange={(runner) => set(i, { runner })} inherit="Agent's" />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove configuration ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" disabled={rows.length >= 6} onClick={() => setRows([...rows, { name: `Configuration ${rows.length + 1}`, harness: INHERIT, model: INHERIT, runner: INHERIT }])}>
              <Plus /> Add configuration
            </Button>
          </div>
        </Field>
        <Field label="Scorers" help="The Correctness Scorer checks each trial against the task's criteria; add factory scorers to grade more.">
          <div className="grid gap-2 sm:grid-cols-2">
            {["correctness", ...scorers].map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(s)} onCheckedChange={(v) => setPicked(v ? [...picked, s] : picked.filter((x) => x !== s))} />
                {s === "correctness" ? "Correctness Scorer" : s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Repetitions" help="Run each task this many times per configuration to see variance.">
          <Input type="number" aria-label="Repetitions" min={1} max={10} value={reps} onChange={(e) => setReps(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-9 w-24" />
        </Field>
        <p className="text-sm">
          <b>{trials}</b> trial{trials === 1 ? "" : "s"}: {rows.length} configuration{rows.length === 1 ? "" : "s"} × {tasks} task{tasks === 1 ? "" : "s"} × {reps} repetition{reps === 1 ? "" : "s"}
        </p>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Boolean(problem) || pending || !tasks} onClick={() => onRun({ configurations: rows.map((r) => fromRow(r, agent)), scorers: picked, repetitions: reps })}>
            {pending ? "Starting…" : "Run benchmark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
