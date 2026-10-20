// Next.js calls register() once per server. OpenTelemetry runs only in the Node.js runtime and only
// when OTEL_EXPORTER_OTLP_ENDPOINT is set; see instrumentation-node.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) await import("./instrumentation-node");
}
