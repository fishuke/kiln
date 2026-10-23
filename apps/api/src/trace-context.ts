// Error responses that can be found in the tracing backend: the active request span records the error,
// a 5xx is logged at ERROR in the request's trace, and the response carries the trace id.
import { SpanStatusCode, isSpanContextValid, trace, type Tracer } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { StudioTracer } from "@kiln/studio";
import type { Context, MiddlewareHandler } from "hono";

/** The active span's trace id; undefined outside a traced request (OpenTelemetry off, or no span). */
export function activeTraceId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.traceId : undefined;
}

/**
 * Records `err` on the active span. A 5xx also sets the span's error status and is logged at ERROR through the
 * OpenTelemetry logs API, in the active trace. Returns the trace id for the response.
 */
export function reportError(err: unknown, status: number, attributes: Record<string, string> = {}): string | undefined {
  const error = err instanceof Error ? err : new Error(String(err));
  const span = trace.getActiveSpan();
  span?.recordException(error);
  if (status >= 500) {
    span?.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    logs.getLogger("kiln-api").emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: `${status} ${error.message}`,
      attributes: {
        "http.response.status_code": status,
        "exception.type": error.name,
        "exception.message": error.message,
        ...(error.stack ? { "exception.stacktrace": error.stack } : {}),
        ...attributes,
      },
    });
  }
  return activeTraceId();
}

/**
 * Middleware: every error response (status 400 and up) gets an `x-trace-id` header, and a JSON error body gets a
 * `traceId` field, so a person can search the tracing backend for it.
 */
export const traceErrorResponses: MiddlewareHandler = async (c: Context, next) => {
  await next();
  const traceId = activeTraceId();
  if (!traceId || c.res.status < 400) return;
  c.res.headers.set("x-trace-id", traceId);
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;
  const body: unknown = await c.res.clone().json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return;
  // Hono's setter keeps the earlier response's other headers.
  c.res = new Response(JSON.stringify({ ...body, traceId }), { status: c.res.status, headers: { "content-type": "application/json" } });
};

/** Studio's spans on OpenTelemetry's global tracer: children of the active span (the request's, when there is one). */
export function otelStudioTracer(tracer: Tracer = trace.getTracer("kiln-studio")): StudioTracer {
  return {
    span: (name, attributes, fn) =>
      tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
          return await fn();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          throw err;
        } finally {
          span.end();
        }
      }),
  };
}
