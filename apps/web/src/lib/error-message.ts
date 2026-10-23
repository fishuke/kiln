import { KilnApiError } from "@kiln/sdk-ts";
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { withTrace } from "./trace-id";

/**
 * Human message for an error, with the trace id to search for in the tracing backend: the API's
 * (KilnApiError.traceId), else the web server's active span (an error in the web itself).
 */
export function errorMessage(err: unknown): string {
  return withTrace(plainMessage(err), (err instanceof KilnApiError ? err.traceId : undefined) ?? webTraceId());
}

function plainMessage(err: unknown): string {
  if (err instanceof KilnApiError) {
    const data = err.body as { message?: string; error?: string; issues?: (string | { message: string; path?: (string | number)[] })[] } | undefined;
    if (data?.issues?.length)
      return data.issues
        .map((i) => (typeof i === "string" ? i.replace(/^:\s*/, "") : i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message))
        .join("; ");
    return data?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/** The active span's trace id; undefined outside a span or when OpenTelemetry is off. */
function webTraceId(): string | undefined {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && isSpanContextValid(ctx) ? ctx.traceId : undefined;
}
