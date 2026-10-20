#!/usr/bin/env node
// Stop: run the tests related to changed files and print a short pass/fail line.
import { execFileSync } from "node:child_process";

try {
  const out = execFileSync("npx", ["vitest", "run", "--changed", "HEAD"], { stdio: "pipe" }).toString();
  const line = out.split("\n").find((l) => l.includes("Tests")) ?? "no related tests";
  console.log(`kiln: ${line.trim()}`);
} catch (err) {
  const out = String(err.stdout ?? "");
  console.error(`kiln: tests failed\n${out.split("\n").filter((l) => /×|FAIL|Tests/.test(l)).slice(0, 15).join("\n")}`);
  process.exit(2);
}
