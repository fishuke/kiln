#!/usr/bin/env node
// PostToolUse(Edit|Write): format the file and typecheck its package.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const event = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = String(event.tool_input?.file_path ?? "");
if (!/\.(ts|tsx|mjs|json|md|yaml)$/.test(file)) process.exit(0);
try {
  execFileSync("npx", ["prettier", "--write", file], { stdio: "ignore" });
} catch {}
if (!/\.(ts|tsx)$/.test(file)) process.exit(0);
try {
  const project = file.includes("/apps/web/") ? ["-p", "apps/web/tsconfig.json"] : ["-p", "tsconfig.json"];
  execFileSync("npx", ["tsc", "--noEmit", ...project], { stdio: "pipe" });
} catch (err) {
  console.error(String(err.stdout ?? err).split("\n").slice(0, 20).join("\n"));
  process.exit(2);
}
