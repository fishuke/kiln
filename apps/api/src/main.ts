import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createMcpHandler } from "@kiln/mcp";
import { createApp } from "./app";
import { kilnFromEnv, seedDemo } from "./config";

const config = kilnFromEnv();
const { kiln } = config;

let app: ReturnType<typeof createApp>;
// MCP calls the API in-process with the caller's token, so scopes are enforced in one place.
const mcp = createMcpHandler(config.publicUrl, async (input, init) => app.fetch(new Request(input as string, init)));
app = createApp(kiln, { devAuth: config.devAuth, mcp, github: config.github, openSignup: config.openSignup });

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Kiln API on ${config.publicUrl} (${config.mode} mode, data in ${config.dataDir})`);
  console.log(`MCP endpoint: ${config.publicUrl}/mcp`);
  if (config.devAuth) console.log("Dev auth is on: every request without a token acts as dev@kiln.local, owner of the default team.");
  else if (kiln.accounts.needsOwner()) console.log(`No team owner yet: the first signup (POST /api/v1/auth/signup) owns the default team.`);
  else if (config.adminToken) console.log(`Admin token (also in ${config.dataDir}/admin-token): ${config.adminToken}`);
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
  kiln.tick({ selfImprovement: ticks % Math.max(1, Math.round(3_600_000 / tickMs)) === 0 }).catch((err) => console.error("tick failed", err));
}, tickMs);
