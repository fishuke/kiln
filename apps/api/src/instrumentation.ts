// OpenTelemetry for the control plane: traces, metrics and logs over OTLP/HTTP (SigNoz, Grafana,
// Honeycomb …). Loaded first with `node --import ./apps/api/src/instrumentation.ts`, so HTTP, fetch
// and fs are patched before the API loads. Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set;
// OTEL_EXPORTER_OTLP_HEADERS, OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES work as usual.
import { register } from "node:module";
import { logs } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { bridgeConsole } from "./console-logs";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  process.env.OTEL_SERVICE_NAME ||= "kiln-api";
  // ES modules are patched through the loader hook rather than require().
  // Only libraries need wrapping (http, undici …); Kiln's own TypeScript packages are left alone.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url, { data: { exclude: [/^file:.*\/(packages|apps)\/[^/]+\/src\//] } });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_VERSION]: process.env.SOURCE_COMMIT || "dev" }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 60_000 })],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-host-metrics": { enabled: true },
        // Every file read of the store and every socket would be a span.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });
  sdk.start();
  bridgeConsole(logs.getLogger("console"));

  const shutdown = () =>
    sdk
      .shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
