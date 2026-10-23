import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { StudioError } from "@kiln/studio";
import { Hono } from "hono";
import { createTestKiln } from "@kiln/engine";
import { createApp } from "./app";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bridgeConsole } from "./console-logs";
import { activeTraceId, otelStudioTracer, reportError, traceErrorResponses } from "./trace-context";

const spans = new InMemorySpanExporter();
const records = new InMemoryLogRecordExporter();
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }));
  logs.setGlobalLoggerProvider(new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter: records })] }));
});
afterAll(() => {
  trace.disable();
  logs.disable();
  context.disable();
});
beforeEach(() => {
  spans.reset();
  records.reset();
});

const tracer = () => trace.getTracer("test");

/** A Hono app whose requests run in a span, as the HTTP instrumentation does in production. */
function app() {
  const a = new Hono();
  a.use("*", (c, next) => tracer().startActiveSpan("GET", async (span) => (await next(), span.end())));
  a.use("/api/*", traceErrorResponses);
  a.get("/api/unavailable", (c) => {
    const err = new StudioError("unavailable", "the app failed to start: tar: .: file changed as we read it");
    reportError(err, 503, { "kiln.studio.error.code": err.code });
    return c.json({ error: err.message, code: err.code }, 503);
  });
  a.get("/api/missing", (c) => c.json({ error: "unknown app sa_1" }, 404));
  a.get("/api/ok", (c) => c.json({ ok: true }));
  return a;
}

describe("every API route's errors carry the trace id", () => {
  it("adds traceId to an auth failure from the real app and records it on the request span", async () => {
    const kilnApp = createApp(createTestKiln({ preview: false }).kiln);
    const res = await tracer().startActiveSpan("GET", async (span) => {
      const r = await kilnApp.request("/api/v1/work-items");
      span.end();
      return r;
    });
    const traceId = spans.getFinishedSpans()[0]!.spanContext().traceId;
    expect(res.status).toBe(401);
    expect(res.headers.get("x-trace-id")).toBe(traceId);
    expect(((await res.json()) as { traceId: string }).traceId).toBe(traceId);
  });
});

describe("error responses carry the trace id", () => {
  it("adds traceId to a JSON error body and the x-trace-id header", async () => {
    const res = await app().request("/api/missing");
    const traceId = spans.getFinishedSpans()[0]!.spanContext().traceId;
    expect(res.status).toBe(404);
    expect(res.headers.get("x-trace-id")).toBe(traceId);
    expect(await res.json()).toEqual({ error: "unknown app sa_1", traceId });
  });

  it("leaves successful responses alone", async () => {
    const res = await app().request("/api/ok");
    expect(res.headers.get("x-trace-id")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("records a 5xx on the request span and logs it at ERROR in the request's trace", async () => {
    const res = await app().request("/api/unavailable");
    const [span] = spans.getFinishedSpans();
    expect(span!.status).toEqual({ code: SpanStatusCode.ERROR, message: "the app failed to start: tar: .: file changed as we read it" });
    expect(span!.events.map((e) => e.name)).toEqual(["exception"]);
    const [record] = records.getFinishedLogRecords();
    expect(record).toMatchObject({ severityText: "ERROR", body: "503 the app failed to start: tar: .: file changed as we read it" });
    expect(record!.attributes).toMatchObject({ "exception.type": "StudioError", "kiln.studio.error.code": "unavailable", "http.response.status_code": 503 });
    expect(record!.spanContext).toMatchObject({ traceId: span!.spanContext().traceId, spanId: span!.spanContext().spanId });
    expect(((await res.json()) as { traceId: string }).traceId).toBe(span!.spanContext().traceId);
  });

  it("records a 4xx on the span without logging it", () => {
    tracer().startActiveSpan("req", (span) => {
      reportError(new Error("bad input"), 400);
      span.end();
    });
    expect(spans.getFinishedSpans()[0]!.status.code).toBe(SpanStatusCode.UNSET);
    expect(records.getFinishedLogRecords()).toEqual([]);
  });

  it("has no trace id outside a span", () => {
    expect(activeTraceId()).toBeUndefined();
  });
});

describe("Studio's tracer", () => {
  it("makes child spans of the active span and records a failure", async () => {
    const studio = otelStudioTracer();
    await tracer().startActiveSpan("POST /chats", async (parent) => {
      await studio.span("studio.resume", { "kiln.studio.app.id": "sa_1" }, async () => {
        await studio.span("studio.install", {}, async () => undefined);
      });
      await expect(studio.span("studio.ready_check", {}, async () => Promise.reject(new Error("never answered")))).rejects.toThrow("never answered");
      parent.end();
    });
    const byName = Object.fromEntries(spans.getFinishedSpans().map((s) => [s.name, s]));
    const parentId = byName["POST /chats"]!.spanContext().spanId;
    expect(byName["studio.resume"]!.parentSpanContext?.spanId).toBe(parentId);
    expect(byName["studio.install"]!.parentSpanContext?.spanId).toBe(byName["studio.resume"]!.spanContext().spanId);
    expect(byName["studio.resume"]!.attributes).toEqual({ "kiln.studio.app.id": "sa_1" });
    expect(byName["studio.ready_check"]!.status).toEqual({ code: SpanStatusCode.ERROR, message: "never answered" });
    expect(byName["studio.ready_check"]!.events.map((e) => e.name)).toEqual(["exception"]);
  });
});

describe("console lines", () => {
  it("carry the active span's trace and span ids", () => {
    const lines: unknown[][] = [];
    const sink = { debug: () => {}, log: () => {}, info: () => {}, warn: () => {}, error: (...a: unknown[]) => void lines.push(a) };
    bridgeConsole(logs.getLogger("console"), sink);
    tracer().startActiveSpan("req", (span) => {
      sink.error("event handler failed", new Error("boom"));
      span.end();
    });
    sink.error("at startup");
    const [inSpan, outside] = records.getFinishedLogRecords();
    const span = spans.getFinishedSpans()[0]!;
    expect(lines).toHaveLength(2);
    expect(inSpan!.severityText).toBe("ERROR");
    expect(inSpan!.attributes).toMatchObject({ "exception.message": "boom" });
    expect(inSpan!.spanContext).toMatchObject({ traceId: span.spanContext().traceId, spanId: span.spanContext().spanId });
    expect(outside!.spanContext).toBeUndefined();
  });
});
