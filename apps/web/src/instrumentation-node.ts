// OpenTelemetry for the web app: Next.js's own spans (routes, rendering, fetch), incoming HTTP, calls
// to the API (fetch carries the trace context, so they join the API's traces), metrics, and every
// console line as a log record linked to its trace. OTEL_EXPORTER_OTLP_HEADERS and
// OTEL_RESOURCE_ATTRIBUTES work as usual; OTEL_SERVICE_NAME defaults to kiln-web.
import { format } from "node:util";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

process.env.OTEL_SERVICE_NAME ||= "kiln-web";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_VERSION]: process.env.SOURCE_COMMIT || "dev" }),
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 60_000 })],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  // Health checks every 2s would be most of the traces.
  instrumentations: [
    new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === "/login" && req.headers["user-agent"]?.startsWith("node") === true }),
    new UndiciInstrumentation(),
  ],
});
sdk.start();

const logger = logs.getLogger("console");
const levels = [
  ["debug", SeverityNumber.DEBUG, "DEBUG"],
  ["log", SeverityNumber.INFO, "INFO"],
  ["info", SeverityNumber.INFO, "INFO"],
  ["warn", SeverityNumber.WARN, "WARN"],
  ["error", SeverityNumber.ERROR, "ERROR"],
] as const;
for (const [method, severityNumber, severityText] of levels) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    original(...args);
    const error = args.find((a): a is Error => a instanceof Error);
    logger.emit({
      severityNumber,
      severityText,
      body: format(...args),
      attributes: error ? { "exception.type": error.name, "exception.message": error.message, "exception.stacktrace": error.stack } : undefined,
    });
  };
}

process.once("SIGTERM", () => {
  sdk
    .shutdown()
    .catch(() => undefined)
    .finally(() => process.exit(0));
});
