#!/usr/bin/env node
// Runs the TypeScript CLI through tsx so the workspace needs no build step.
import { register } from "tsx/esm/api";
register();
const { runCli } = await import("../src/main.ts");
const code = await runCli(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s), cwd: process.env.INIT_CWD ?? process.cwd(), env: process.env });
process.exit(code);
