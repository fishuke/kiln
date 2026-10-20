import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agents, factory, milestones, sideStates, workItemStates } from "@/lib/factory";

export default function Home() {
  const totalTasks = milestones.reduce((sum, m) => sum + m.tasks, 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{factory.name}</h1>
          <Badge variant="secondary">@{factory.alias}</Badge>
          <Badge variant="outline">{factory.schemaVersion}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">{factory.product}</p>
        <p className="text-muted-foreground text-sm">
          Repository: <code className="font-mono">{factory.repository}</code>
        </p>
        <Link
          href="/todo"
          className="text-foreground hover:bg-muted focus-visible:ring-ring/50 mt-2 inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3"
        >
          Open to-do list <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Agents</CardTitle>
          <CardDescription>Declared in factory/agents/. Humans approve specs and merge.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>agentType</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.name}>
                  <TableCell className="font-mono">{agent.name}</TableCell>
                  <TableCell className="font-mono text-xs">{agent.agentType}</TableCell>
                  <TableCell className="whitespace-normal">{agent.job}</TableCell>
                  <TableCell>
                    <Badge variant={agent.enabled ? "default" : "outline"}>
                      {agent.enabled ? "Enabled" : "Off"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work item lifecycle</CardTitle>
          <CardDescription>Every transition emits work_item.stage_changed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex flex-wrap items-center gap-2">
            {workItemStates.map((state, i) => (
              <li key={state} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {state}
                </Badge>
                {i < workItemStates.length - 1 && <span className="text-muted-foreground">→</span>}
              </li>
            ))}
          </ol>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {sideStates.map((state) => (
              <Badge key={state} variant="secondary" className="font-mono">
                {state}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build plan</CardTitle>
          <CardDescription>
            {milestones.length} milestones, {totalTasks} tasks. Source: docs/plan/PLAN.md.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Milestone</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">Tasks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono">{m.id}</TableCell>
                  <TableCell>{m.title}</TableCell>
                  <TableCell className="text-muted-foreground">{m.weeks}</TableCell>
                  <TableCell className="text-right">{m.tasks}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
