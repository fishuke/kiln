#!/usr/bin/env node
// pnpm dev: the API (with demo data, dev auth) on :4000 and the web app on :3000.
import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env, KILN_DEV_AUTH: process.env.KILN_DEV_AUTH ?? "1", KILN_API_URL: "http://localhost:4000" };
delete env.NODE_ENV;

// Docker sandboxes with an egress list need the kiln-egress network and the proxy on it.
const PROXY = "docker compose up -d --build egress-proxy";
if ((env.KILN_SANDBOX ?? "docker") === "docker" && !env.KILN_EGRESS_PROXY) {
  const up = spawnSync("docker", PROXY.split(" ").slice(1), { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (up.status === 0) console.log("Sandbox egress proxy is up (kiln-egress-proxy).");
  else console.warn(`Could not start the sandbox egress proxy; runs that need the network will fail. Start Docker, then run: ${PROXY}\n${(up.stderr ?? up.error?.message ?? "").trim().split("\n").slice(-3).join("\n")}`);
}

const procs = [
  spawn("npx", ["tsx", "watch", "apps/api/src/main.ts"], { stdio: "inherit", env }),
  spawn("pnpm", ["--filter", "@kiln/web", "dev"], { stdio: "inherit", env }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
