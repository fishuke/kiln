/** Span attributes Studio sets (OpenTelemetry's primitive attribute values). */
export type StudioSpanAttributes = Record<string, string | number | boolean>;

/**
 * Spans for Studio's slow steps (provision, resume, snapshot, dev server start, ready check, apply).
 * The API passes one backed by OpenTelemetry's global tracer (apps/api/src/telemetry.ts); Studio never imports OpenTelemetry.
 */
export interface StudioTracer {
  /**
   * Runs `fn` in a span named `name`, a child of the active span when there is one. When `fn` throws, the span
   * records the exception and ends with error status, and the error is rethrown.
   */
  span<T>(name: string, attributes: StudioSpanAttributes, fn: () => Promise<T>): Promise<T>;
}

/** Records nothing; the default when no tracer is passed. */
export const NOOP_TRACER: StudioTracer = { span: (_name, _attributes, fn) => fn() };
