"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AgentTypeIcon } from "@/components/kiln/agent-type-icon";
import { Field } from "@/components/kiln/form-controls";
import { PageHeader } from "@/components/kiln/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toastResult } from "@/lib/toast-result";
import { createBenchmark, type NewTask } from "../actions";
import { AddTaskDialog } from "./task-dialog";

export function NewBenchmark({ factory, factoryName, agents }: { factory: string; factoryName: string; agents: { name: string; agentType: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("");
  const [tasks, setTasks] = useState<NewTask[]>([]);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const valid = name.trim() && agent && tasks.length > 0;
  const save = () =>
    start(async () => {
      const r = await createBenchmark(factory, { name, description, agent, tasks });
      if (toastResult(r, "Benchmark created") && r.ok && r.slug && !r.pullRequest) router.push(`/f/${factory}/benchmarks/${encodeURIComponent(r.slug)}`);
    });
  return (
    <>
      <PageHeader
        crumbs={[{ label: factoryName, href: `/f/${factory}/dashboard` }, { label: "Benchmarks", href: `/f/${factory}/benchmarks` }, { label: name.trim() || "Untitled" }]}
        actions={
          <>
            <Link href={`/f/${factory}/benchmarks`} className={buttonVariants({ variant: "outline" })}>
              Cancel
            </Link>
            <Button onClick={save} disabled={!valid || pending} variant={valid ? "default" : "secondary"}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-[768px] space-y-8 px-6 py-10">
        <input autoFocus aria-label="Benchmark name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter benchmark name" className="w-full bg-transparent text-[28px] leading-tight font-semibold tracking-tight outline-none placeholder:text-muted-foreground/70" />
        <Field label="Description" help="Describe what this benchmark is intended to measure.">
          <Textarea aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe this benchmark" />
        </Field>
        <Field label="Agent to evaluate" required help="Choose the agent whose behavior this benchmark will test.">
          <Select value={agent} onValueChange={(v) => (v === "__new__" ? router.push(`/f/${factory}/agents/new`) : setAgent(String(v)))}>
            <SelectTrigger aria-label="Agent to evaluate" className="h-10 w-full">
              <SelectValue>
                {(v: string) =>
                  v ? (
                    <span className="flex items-center gap-2">
                      <AgentTypeIcon type={agents.find((a) => a.name === v)?.agentType} /> {v}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Add agent</span>
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.name} value={a.name}>
                  <AgentTypeIcon type={a.agentType} /> {a.name}
                </SelectItem>
              ))}
              <SelectItem value="__new__">New agent</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tasks">
          <div className="rounded-xl border">
            {tasks.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <ul className="divide-y">
                {tasks.map((t, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.kind === "scratch" ? t.task.title : t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.kind === "scratch" ? `${t.task.successCriteria.length} criteria` : "from run"}</span>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove task" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t px-2 py-1">
              <Button variant="ghost" disabled={!agent} onClick={() => setAdding(true)}>
                <Plus /> Add task
              </Button>
            </div>
          </div>
          {!agent && <p className="text-xs text-muted-foreground">Choose an agent to evaluate before adding tasks.</p>}
        </Field>
      </div>
      <AddTaskDialog
        factory={factory}
        agent={agent || undefined}
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(t) => {
          setTasks([...tasks, t]);
          setAdding(false);
        }}
      />
    </>
  );
}
