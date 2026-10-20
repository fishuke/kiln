import type { Kiln } from "./kiln";
import { runState } from "./run-state";
import { C, type Run, type WorkItem } from "./types";

export type Metric = { name: string; help: string; type: "gauge" | "counter"; samples: { labels?: Record<string, string>; value: number }[] };

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

/** Prometheus text exposition format (version 0.0.4). */
export function formatPrometheus(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`);
    for (const s of m.samples) {
      const labels = s.labels && Object.keys(s.labels).length ? `{${Object.entries(s.labels).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "";
      lines.push(`${m.name}${labels} ${Number.isFinite(s.value) ? s.value : 0}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

const count = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()];
};

/** Server-side metrics for /metrics: runs, tasks, gates, workers and the worker queue. */
export function serverMetrics(k: Kiln, extra: Metric[] = []): string {
  const runs = k.store.list<Run>(C.runs);
  const items = k.store.list<WorkItem>(C.workItems, (w) => !w.deletedAt);
  const workers = k.workers.stats();
  return formatPrometheus([
    { name: "kiln_runs_total", help: "Runs by factory and state.", type: "counter", samples: count(runs, (r) => `${r.factory}\u0000${runState(r)}`).map(([key, value]) => ({ labels: { factory: key.split("\u0000")[0]!, state: key.split("\u0000")[1]! }, value })) },
    { name: "kiln_runs_active", help: "Runs executing now.", type: "gauge", samples: [{ value: runs.filter((r) => k.runs.isActive(r.id)).length }] },
    { name: "kiln_run_cost_usd_total", help: "Spend reported by runs, by factory.", type: "counter", samples: count(runs, (r) => r.factory).map(([factory]) => ({ labels: { factory }, value: Math.round(runs.filter((r) => r.factory === factory).reduce((s, r) => s + r.costUsd, 0) * 10_000) / 10_000 })) },
    { name: "kiln_tasks", help: "Tasks by factory and state.", type: "gauge", samples: count(items, (w) => `${w.factory}\u0000${w.state}`).map(([key, value]) => ({ labels: { factory: key.split("\u0000")[0]!, state: key.split("\u0000")[1]! }, value })) },
    { name: "kiln_gates_open", help: "Decisions waiting on people.", type: "gauge", samples: [{ value: k.gates.list({ state: "open" }).length }] },
    { name: "kiln_factories", help: "Factories on this server.", type: "gauge", samples: [{ value: k.defs.list().length }] },
    { name: "kiln_workers_connected", help: "Connected self-hosted worker processes.", type: "gauge", samples: [{ value: workers.connected }] },
    { name: "kiln_worker_runs_active", help: "Runs executing on self-hosted workers.", type: "gauge", samples: [{ value: workers.active }] },
    { name: "kiln_worker_queue_depth", help: "Runs waiting for a self-hosted worker.", type: "gauge", samples: [{ value: workers.queued }] },
    ...extra,
  ]);
}
