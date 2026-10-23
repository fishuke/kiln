import { InMemoryEventBus } from "@kiln/events";
import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { createSocket } from "node:dgram";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bridgeEvents, engineTelemetry, listenEgressLogs, parseSquidLine, runSpanId, workItemTraceId } from "./telemetry";

function setup(
  runs: Record<string, Parameters<typeof bridgeEvents>[1]["run"] extends (id: string) => infer R ? NonNullable<R> : never> = {},
  gates: Record<string, { runId?: string }> = {},
) {
  const spans = new InMemorySpanExporter();
  const logs = new InMemoryLogRecordExporter();
  const t = engineTelemetry({ traces: new SimpleSpanProcessor(spans), logs: new SimpleLogRecordProcessor({ exporter: logs }) });
  const bus = new InMemoryEventBus();
  bridgeEvents(bus, { run: (id) => runs[id], gate: (id) => gates[id] }, t);
  return { bus, spans, logs, t };
}

const run = {
  id: "run_1",
  workItemId: "wi_1",
  factory: "poe-bot",
  agent: "foreman",
  harness: "claude-code",
  model: "claude-opus-5-5",
  stage: "implement",
  traceId: "a".repeat(32),
  status: "failed" as const,
  summary: "claude exited with code 1: unknown option --foo",
  error: { code: "harness_exit", message: "exited with code 1", retryable: false },
  costUsd: 0,
  eventCount: 2,
  startedAt: "2026-10-20T18:27:36.000Z",
  finishedAt: "2026-10-20T18:27:40.000Z",
};

describe("engine telemetry", () => {
  it("puts a work item's stages and runs in one trace, with the run's failure on its span", () => {
    const { bus, spans } = setup({ run_1: run });
    bus.publish("work_item.created", { workItemId: "wi_1", factory: "poe-bot", source: "chat" });
    bus.publish("work_item.stage_changed", { workItemId: "wi_1", factory: "poe-bot", from: "received", to: "building", reason: "implement started" });
    bus.publish("run.finished", { runId: "run_1", outcome: "failed", costUsd: 0 });

    const out = spans.getFinishedSpans();
    const traceId = workItemTraceId("wi_1");
    expect(out.map((s) => s.name)).toEqual(["work item", "stage received", "run foreman"]);
    expect(out.every((s) => s.spanContext().traceId === traceId)).toBe(true);
    const root = out[0]!;
    const r = out[2]!;
    expect(r.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(r.spanContext().spanId).toBe(runSpanId("run_1"));
    expect(r.status).toEqual({ code: SpanStatusCode.ERROR, message: run.summary });
    expect(r.attributes).toMatchObject({ "kiln.run.id": "run_1", "kiln.run.status": "failed", "kiln.agent": "foreman", "kiln.run.error.code": "harness_exit" });
    expect(r.startTime).toEqual([Date.parse(run.startedAt) / 1000, 0]);
  });

  it("logs every run event on the run's span and a failed run as an error", () => {
    const { bus, logs } = setup({ run_1: run });
    bus.publish("run.event", { runId: "run_1", seq: 1, type: "started", text: "foreman (claude-code)" });
    bus.publish("run.event", { runId: "run_1", seq: 2, type: "error", text: "unknown option --foo" });
    bus.publish("run.finished", { runId: "run_1", outcome: "failed", costUsd: 0 });

    const records = logs.getFinishedLogRecords();
    const error = records.find((l) => l.body === "error: unknown option --foo")!;
    expect(error.severityText).toBe("ERROR");
    expect(error.spanContext).toMatchObject({ traceId: workItemTraceId("wi_1"), spanId: runSpanId("run_1") });
    expect(error.attributes).toMatchObject({ "kiln.run.id": "run_1", "kiln.run.event": "error", "kiln.work_item.id": "wi_1" });
    const failed = records.find((l) => l.body === `run foreman failed: ${run.summary}`)!;
    expect(failed.severityText).toBe("ERROR");
  });

  it("logs the other events in the work item's trace", () => {
    const { bus, logs } = setup();
    bus.publish("gate.opened", { gateId: "gate_1", workItemId: "wi_1", kind: "question", assignees: [] });
    const [record] = logs.getFinishedLogRecords();
    expect(record).toMatchObject({ body: "gate.opened", attributes: { "kiln.gate_id": "gate_1", "kiln.kind": "question" } });
    expect(record!.spanContext?.traceId).toBe(workItemTraceId("wi_1"));
  });

  it("logs a run's command approval on the run's span, in the run's trace", () => {
    const studioRun = { ...run, id: "run_3", factory: "app:sa_1", workItemId: undefined, status: "running" as const };
    const { bus, logs } = setup({ run_3: studioRun }, { gate_2: { runId: "run_3" } });
    bus.publish("gate.opened", { gateId: "gate_2", workItemId: "run:run_3", kind: "question", assignees: [] });
    bus.publish("gate.decided", { gateId: "gate_2", workItemId: "run:run_3", decision: "approve", by: "ada@acme.test" });
    const records = logs.getFinishedLogRecords();
    expect(records.map((r) => r.body)).toEqual(["gate.opened", "gate.decided"]);
    for (const r of records) {
      expect(r.spanContext).toMatchObject({ traceId: run.traceId, spanId: runSpanId("run_3") });
      expect(r.attributes).toMatchObject({ "kiln.run.id": "run_3", "kiln.gate_id": "gate_2" });
    }
  });

  it("uses the run's own trace when it has no work item", () => {
    const { bus, spans } = setup({ run_2: { ...run, id: "run_2", workItemId: undefined, status: "succeeded" } });
    bus.publish("run.finished", { runId: "run_2", outcome: "succeeded", costUsd: 0 });
    const [span] = spans.getFinishedSpans();
    expect(span!.spanContext().traceId).toBe(run.traceId);
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });
});

describe("egress proxy logs", () => {
  it("parses squid's native access log line", () => {
    expect(parseSquidLine("1792520855.123    412 172.20.0.5 TCP_DENIED/403 3912 CONNECT evil.example.com:443 - HIER_NONE/- text/html")).toEqual({
      severity: "WARN",
      body: "TCP_DENIED/403 CONNECT evil.example.com:443",
      attributes: {
        "client.address": "172.20.0.5",
        "egress.action": "TCP_DENIED",
        "http.response.status_code": 403,
        "http.request.method": "CONNECT",
        "url.full": "evil.example.com:443",
        "egress.bytes": 3912,
        "egress.duration_ms": 412,
      },
    });
  });

  it("drops datagrams from refused senders, such as Studio sandboxes", async () => {
    const logs = new InMemoryLogRecordExporter();
    const t = engineTelemetry({ traces: new SimpleSpanProcessor(new InMemorySpanExporter()), logs: new SimpleLogRecordProcessor({ exporter: logs }) });
    const seen: string[] = [];
    const socket = await listenEgressLogs(0, t.egressLogger, (address) => (seen.push(address), true));
    const client = createSocket("udp4");
    client.send("1792520855.123 10 172.20.0.5 TCP_TUNNEL/200 5000 CONNECT github.com:443 - HIER_DIRECT/1.2.3.4 -\n", socket.address().port, "127.0.0.1");
    const start = Date.now();
    while (!seen.length && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 10));
    client.close();
    socket.close();
    expect(seen).toEqual(["127.0.0.1"]);
    expect(logs.getFinishedLogRecords()).toHaveLength(0);
  });

  it("turns datagrams into log records", async () => {
    const logs = new InMemoryLogRecordExporter();
    const t = engineTelemetry({ traces: new SimpleSpanProcessor(new InMemorySpanExporter()), logs: new SimpleLogRecordProcessor({ exporter: logs }) });
    const socket = await listenEgressLogs(0, t.egressLogger);
    const client = createSocket("udp4");
    client.send("1792520855.123 10 172.20.0.5 TCP_TUNNEL/200 5000 CONNECT github.com:443 - HIER_DIRECT/1.2.3.4 -\n", socket.address().port, "127.0.0.1");
    const start = Date.now();
    while (!logs.getFinishedLogRecords().length && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 10));
    client.close();
    socket.close();
    expect(logs.getFinishedLogRecords()[0]).toMatchObject({ body: "TCP_TUNNEL/200 CONNECT github.com:443", severityText: "INFO" });
  });
});

describe("Studio failures", () => {
  // Studio publishes its failures inside a span (the provision or ready check span, or the request's).
  const manager = new AsyncLocalStorageContextManager();
  beforeAll(() => void context.setGlobalContextManager(manager.enable()));
  afterAll(() => context.disable());
  const inSpan = (fn: () => void) =>
    new BasicTracerProvider().getTracer("test").startActiveSpan("studio.provision", (span) => (fn(), span.end(), span.spanContext()));

  it("logs a failed App setup at ERROR in the active trace", () => {
    const { bus, logs } = setup();
    const span = inSpan(() => bus.publish("studio.app_failed", { appId: "sa_1", error: "git init -q -b main failed in app: boom", priority: "needs_you" }));
    const [record] = logs.getFinishedLogRecords();
    expect(record).toMatchObject({
      severityText: "ERROR",
      body: "studio.app_failed: git init -q -b main failed in app: boom",
      attributes: { "kiln.app_id": "sa_1", "kiln.error": "git init -q -b main failed in app: boom" },
    });
    expect(record!.spanContext).toMatchObject({ traceId: span.traceId, spanId: span.spanId });
  });

  it("logs a failed preview at WARN with all of the dev server's output", () => {
    const { bus, logs } = setup();
    const output = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(150)}`).join("\n");
    const span = inSpan(() =>
      bus.publish("studio.preview_failed", {
        appId: "sa_1",
        chatId: "sc_1",
        port: 4101,
        reason: "the dev server exited with code 1",
        output,
        priority: "progress",
      }),
    );
    const [record] = logs.getFinishedLogRecords();
    expect(record).toMatchObject({
      severityText: "WARN",
      body: "studio.preview_failed: the dev server exited with code 1",
      attributes: { "kiln.app_id": "sa_1", "kiln.chat_id": "sc_1", "kiln.port": 4101, "kiln.output": output },
    });
    expect(record!.spanContext?.traceId).toBe(span.traceId);
  });

  it("logs other Studio events at INFO", () => {
    const { bus, logs } = setup();
    bus.publish("studio.version_created", { appId: "sa_1", versionId: "sv_1", title: "Created", kind: "initial", priority: "finished" });
    expect(logs.getFinishedLogRecords()[0]).toMatchObject({ severityText: "INFO", body: "studio.version_created" });
  });
});
