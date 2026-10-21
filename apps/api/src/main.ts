import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createMcpHandler } from "@kiln/mcp";
import { createApp } from "./app";
import { kilnFromEnv, seedDemo } from "./config";
import { bridgeEvents, engineTelemetry, listenEgressLogs } from "./telemetry";

const config = kilnFromEnv();
const { kiln } = config;

// Engine events (stages, runs, run events) and the egress proxy's access log go to the OTLP backend too.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const telemetry = engineTelemetry();
  bridgeEvents(kiln.bus, { run: (id) => kiln.runs.get(id) }, telemetry);
  void listenEgressLogs(Number(process.env.KILN_EGRESS_LOG_PORT ?? 5140), telemetry.egressLogger);
  process.once("SIGTERM", () => void telemetry.shutdown());
}

// Runs and stage steps live in this process; whatever the last one left going cannot finish now.
const recovered = kiln.recoverInterrupted();
if (recovered.runs.length || recovered.workItems.length) console.log(`Stopped ${recovered.runs.length} run(s) and ${recovered.workItems.length} task(s) cut off by the last restart.`);
// Their sandboxes are still on disk or running as containers; remove them before they fill the host.
void kiln.sweepSandboxes().then((removed) => removed.length && console.log(`Removed ${removed.length} sandbox(es) left by the last restart.`));

let app: ReturnType<typeof createApp>;
// MCP calls the API in-process with the caller's token, so scopes are enforced in one place.
const mcp = createMcpHandler(config.publicUrl, async (input, init) => app.fetch(new Request(input as string, init)), { resourceMetadata: `${config.publicUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp` });
app = createApp(kiln, { devAuth: config.devAuth, mcp, github: config.github, openSignup: config.openSignup });

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Kiln API on ${config.publicUrl} (${config.mode} mode, data in ${config.dataDir})`);
  console.log(`MCP endpoint: ${config.publicUrl}/mcp`);
  if (config.devAuth) console.log("Dev auth is on: every request without a token acts as dev@kiln.local, owner of the default team.");
  else if (kiln.accounts.needsOwner()) console.log(`No team owner yet: the first signup (POST /api/v1/auth/signup) owns the default team.`);
  else if (config.adminToken) console.log(`Admin token: in ${config.dataDir}/admin-token`);
});

if (process.env.KILN_DEMO !== "0") {
  seedDemo(kiln, resolve(process.env.KILN_ROOT ?? process.cwd()))
    .then((seeded) => seeded && console.log("Seeded demo factories, a project and work in every stage."))
    .catch((err) => console.error("demo seed failed", err));
}

const tickMs = Number(process.env.KILN_TICK_MS ?? 15_000);
let ticks = 0;
setInterval(() => {
  ticks += 1;
  kiln.tick({ selfImprovement: ticks % Math.max(1, Math.round(3_600_000 / tickMs)) === 0, sweepSandboxes: ticks % Math.max(1, Math.round(600_000 / tickMs)) === 0 }).catch((err) => console.error("tick failed", err));
}, tickMs);
