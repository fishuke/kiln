#!/usr/bin/env node
// pnpm dev: the API (with demo data, dev auth) on :4000 and the web app on :3000.
import { spawn } from "node:child_process";

const env = { ...process.env, KILN_DEV_AUTH: process.env.KILN_DEV_AUTH ?? "1", KILN_API_URL: "http://localhost:4000" };
delete env.NODE_ENV;
const procs = [
  spawn("npx", ["tsx", "watch", "apps/api/src/main.ts"], { stdio: "inherit", env }),
  spawn("pnpm", ["--filter", "@kiln/web", "dev"], { stdio: "inherit", env }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
