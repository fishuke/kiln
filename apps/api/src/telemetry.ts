// What the engine does, in the OpenTelemetry backend: one trace per work item with a span per stage
// and per agent run (the failure reason on its status), every run event as a log record on that
// run's span, and the egress proxy's access log as its own service. Trace and span ids are derived
// from Kiln ids, so spans emitted after a restart still land in the same trace.
import { createHash, randomBytes } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace, type Attributes, type Context, type Tracer } from "@opentelemetry/api";
import { SeverityNumber, type AnyValueMap, type Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, BatchSpanProcessor, type IdGenerator, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import type { EventBus, KilnEvent } from "@kiln/events";
import type { Run } from "@kiln/engine";

type RunInfo = Pick<Run, "id" | "factory" | "agent" | "harness" | "traceId" | "status" | "costUsd" | "eventCount" | "startedAt"> &
  Partial<Pick<Run, "workItemId" | "parentRunId" | "model" | "stage" | "summary" | "error" | "finishedAt">>;
export type TelemetryLookup = { run(id: string): RunInfo | undefined };

const hash = (s: string, hexChars: number) => createHash("sha256").update(s).digest("hex").slice(0, hexChars);
export const workItemTraceId = (id: string) => hash(`kiln:work_item:${id}`, 32);
export const workItemSpanId = (id: string) => hash(`kiln:work_item_span:${id}`, 16);
export const runSpanId = (id: string) => hash(`kiln:run:${id}`, 16);

/** Random ids, except for the next span when its ids are forced (spans are created synchronously). */
class KilnIds implements IdGenerator {
  private next?: { traceId?: string; spanId: string };
  with<T>(ids: { traceId?: string; spanId: string }, fn: () => T): T {
    this.next = ids;
    try {
      return fn();
    } finally {
      this.next = undefined;
    }
  }
  generateTraceId() {
    return this.next?.traceId ?? randomBytes(16).toString("hex");
  }
  generateSpanId() {
    return this.next?.spanId ?? randomBytes(8).toString("hex");
  }
}

export type EngineTelemetry = { tracer: Tracer; logger: Logger; egressLogger: Logger; ids: KilnIds; shutdown(): Promise<void> };

/** Its own providers (not the global ones), so span ids can be forced without touching HTTP tracing. */
export function engineTelemetry(opts: { traces?: SpanProcessor; logs?: LogRecordProcessor; egressLogs?: LogRecordProcessor } = {}): EngineTelemetry {
  const base = defaultResource().merge(resourceFromAttributes({ [ATTR_SERVICE_VERSION]: process.env.SOURCE_COMMIT || "dev" }));
  const named = (name: string) => base.merge(resourceFromAttributes({ [ATTR_SERVICE_NAME]: name }));
  const service = process.env.OTEL_SERVICE_NAME || "kiln-api";
  const ids = new KilnIds();
  const tracerProvider = new BasicTracerProvider({
    resource: named(service),
    idGenerator: ids,
    spanProcessors: [opts.traces ?? new BatchSpanProcessor(new OTLPTraceExporter(), { scheduledDelayMillis: 1000 })],
  });
  const loggerProvider = new LoggerProvider({
    resource: named(service),
    processors: [opts.logs ?? new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 1000 })],
  });
  const egressProvider = new LoggerProvider({
    resource: named("kiln-egress-proxy"),
    processors: [opts.egressLogs ?? opts.logs ?? new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 1000 })],
  });
  return {
    tracer: tracerProvider.getTracer("kiln-engine"),
    logger: loggerProvider.getLogger("kiln-engine"),
    egressLogger: egressProvider.getLogger("squid"),
    ids,
    shutdown: async () => {
      await Promise.allSettled([tracerProvider.shutdown(), loggerProvider.shutdown(), egressProvider.shutdown()]);
    },
  };
}

const at = (iso: string) => new Date(iso);
const clip = (s: string, n = 16_000) => (s.length > n ? `${s.slice(0, n)}…` : s);
const remote = (traceId: string, spanId: string): Context =>
  trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: TraceFlags.SAMPLED, isRemote: true });

/** Primitive payload fields as `kiln.<field>` attributes (snake_case). */
function payloadAttributes(payload: object): AnyValueMap {
  const out: AnyValueMap = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      out[`kiln.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`] = typeof v === "string" ? clip(v, 4000) : v;
  }
  return out;
}

const SEVERITY: Record<string, [SeverityNumber, string]> = {
  error: [SeverityNumber.ERROR, "ERROR"],
  guard: [SeverityNumber.WARN, "WARN"],
  retry: [SeverityNumber.WARN, "WARN"],
  mcp_skipped: [SeverityNumber.WARN, "WARN"],
};

/** Subscribes to the bus and turns engine events into spans and log records. Returns the unsubscribe function. */
export function bridgeEvents(bus: EventBus, lookup: TelemetryLookup, t: EngineTelemetry): () => void {
  const lastStageChange = new Map<string, string>();
  const runs = new Map<string, RunInfo>();
  const runInfo = (id: string) => {
    const cached = runs.get(id);
    if (cached) return cached;
    const r = lookup.run(id);
    if (r) runs.set(id, r);
    return r;
  };
  const runTrace = (r: RunInfo) => (r.workItemId ? workItemTraceId(r.workItemId) : r.traceId);
  const runAttributes = (r: RunInfo): Attributes => ({
    "kiln.run.id": r.id,
    "kiln.factory": r.factory,
    "kiln.agent": r.agent,
    "kiln.harness": r.harness,
    ...(r.model ? { "kiln.model": r.model } : {}),
    ...(r.stage ? { "kiln.stage": r.stage } : {}),
    ...(r.workItemId ? { "kiln.work_item.id": r.workItemId } : {}),
    ...(r.parentRunId ? { "kiln.run.parent_id": r.parentRunId } : {}),
  });

  const onRunEvent = (e: KilnEvent<"run.event">) => {
    const r = runInfo(e.payload.runId);
    const [severityNumber, severityText] = SEVERITY[e.payload.type] ?? [SeverityNumber.INFO, "INFO"];
    const data = e.payload.data === undefined ? undefined : JSON.stringify(e.payload.data);
    t.logger.emit({
      timestamp: at(e.at),
      severityNumber,
      severityText,
      body: clip(e.payload.text ? `${e.payload.type}: ${e.payload.text}` : e.payload.type),
      attributes: {
        ...(r ? (runAttributes(r) as AnyValueMap) : { "kiln.run.id": e.payload.runId }),
        "kiln.run.event": e.payload.type,
        "kiln.run.seq": e.payload.seq,
        ...(data ? { "kiln.run.data": clip(data, 4000) } : {}),
      },
      ...(r ? { context: remote(runTrace(r), runSpanId(r.id)) } : {}),
    });
  };

  const onRunFinished = (e: KilnEvent<"run.finished">) => {
    runs.delete(e.payload.runId);
    const r = lookup.run(e.payload.runId);
    if (!r) return;
    const traceId = runTrace(r);
    const parentSpan = r.parentRunId ? runSpanId(r.parentRunId) : r.workItemId ? workItemSpanId(r.workItemId) : undefined;
    const failed = e.payload.outcome === "failed";
    const reason = r.summary || r.error?.message || r.status;
    const span = t.ids.with({ traceId, spanId: runSpanId(r.id) }, () =>
      t.tracer.startSpan(
        `run ${r.agent}`,
        {
          startTime: at(r.startedAt),
          attributes: {
            ...runAttributes(r),
            "kiln.run.status": r.status,
            "kiln.run.cost_usd": e.payload.costUsd,
            "kiln.run.events": r.eventCount,
            ...(r.summary ? { "kiln.run.summary": clip(r.summary, 4000) } : {}),
            ...(r.error ? { "kiln.run.error.code": r.error.code, "kiln.run.error.message": clip(r.error.message, 4000) } : {}),
          },
        },
        parentSpan ? remote(traceId, parentSpan) : ROOT_CONTEXT,
      ),
    );
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
    span.end(at(r.finishedAt ?? e.at));
    if (failed)
      t.logger.emit({
        timestamp: at(e.at),
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: clip(`run ${r.agent} failed: ${reason}`),
        attributes: { ...(runAttributes(r) as AnyValueMap), "kiln.run.status": r.status, ...(r.error ? { "kiln.run.error.code": r.error.code } : {}) },
        context: remote(traceId, runSpanId(r.id)),
      });
  };

  const onWorkItemCreated = (e: KilnEvent<"work_item.created">) => {
    const id = e.payload.workItemId;
    lastStageChange.set(id, e.at);
    const span = t.ids.with({ traceId: workItemTraceId(id), spanId: workItemSpanId(id) }, () =>
      t.tracer.startSpan(
        "work item",
        { startTime: at(e.at), attributes: { "kiln.work_item.id": id, "kiln.factory": e.payload.factory, "kiln.source": e.payload.source } },
        ROOT_CONTEXT,
      ),
    );
    span.end(at(e.at));
  };

  const onStageChanged = (e: KilnEvent<"work_item.stage_changed">) => {
    const { workItemId: id, from, to, reason, factory } = e.payload;
    const start = lastStageChange.get(id) ?? e.at;
    if (["complete", "cancelled", "failed", "handed_off"].includes(to)) lastStageChange.delete(id);
    else lastStageChange.set(id, e.at);
    const span = t.tracer.startSpan(
      `stage ${from}`,
      {
        startTime: at(start),
        attributes: { "kiln.work_item.id": id, "kiln.factory": factory, "kiln.stage.from": from, "kiln.stage.to": to, "kiln.stage.reason": clip(reason, 4000) },
      },
      remote(workItemTraceId(id), workItemSpanId(id)),
    );
    if (to === "failed") span.setStatus({ code: SpanStatusCode.ERROR, message: reason });
    span.end(at(e.at));
  };

  return bus.subscribe("*", (e: KilnEvent) => {
    if (e.type === "run.event") return onRunEvent(e as KilnEvent<"run.event">);
    if (e.type === "run.finished") onRunFinished(e as KilnEvent<"run.finished">);
    else if (e.type === "work_item.created") onWorkItemCreated(e as KilnEvent<"work_item.created">);
    else if (e.type === "work_item.stage_changed") onStageChanged(e as KilnEvent<"work_item.stage_changed">);
    const workItemId = "workItemId" in e.payload ? e.payload.workItemId : undefined;
    t.logger.emit({
      timestamp: at(e.at),
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: e.type,
      attributes: payloadAttributes(e.payload),
      ...(workItemId ? { context: remote(workItemTraceId(workItemId), workItemSpanId(workItemId)) } : {}),
    });
  });
}

/** One line of squid's native access log: time elapsed client action/code bytes method URL user hierarchy type. */
export function parseSquidLine(line: string): { severity: "INFO" | "WARN"; body: string; attributes: AnyValueMap } | undefined {
  const f = line.trim().split(/\s+/);
  if (f.length < 7) return undefined;
  const [, elapsed, client, result, bytes, method, url] = f as [string, string, string, string, string, string, string];
  const [action, code] = result.split("/") as [string, string | undefined];
  return {
    severity: action.includes("DENIED") || Number(code) >= 400 ? "WARN" : "INFO",
    body: `${result} ${method} ${url}`,
    attributes: {
      "client.address": client,
      "egress.action": action,
      "http.response.status_code": Number(code),
      "http.request.method": method,
      "url.full": url,
      "egress.bytes": Number(bytes),
      "egress.duration_ms": Number(elapsed),
    },
  };
}

/** Receives the egress proxy's access log over UDP (squid `access_log udp://…`) as log records. */
export function listenEgressLogs(port: number, logger: Logger): Promise<Socket> {
  const socket = createSocket("udp4");
  socket.on("message", (msg) => {
    for (const line of msg.toString("utf8").split("\n")) {
      const parsed = parseSquidLine(line);
      if (!parsed) continue;
      logger.emit({
        severityNumber: parsed.severity === "WARN" ? SeverityNumber.WARN : SeverityNumber.INFO,
        severityText: parsed.severity,
        body: parsed.body,
        attributes: parsed.attributes,
      });
    }
  });
  socket.on("error", (err) => console.error("egress log listener failed", err));
  return new Promise((resolve) => socket.bind(port, () => resolve(socket)));
}
