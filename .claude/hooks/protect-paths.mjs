#!/usr/bin/env node
// PreToolUse(Edit|Write): block edits to protected paths unless the prompt carries an explicit approval phrase.
import { readFileSync } from "node:fs";

const PROTECTED = [/^packages\/definitions\/src\/validate/, /^apps\/api\/src\/app\.ts$/, /^packages\/auth\//, /(^|\/)policies\//, /^packages\/engine\/src\/(gates|state)\.ts$/, /^\.github\/workflows\//, /^factories\/kiln-self\/policies\//];
const APPROVAL = "approved: edit protected path";

const event = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = String(event.tool_input?.file_path ?? "").replace(`${process.cwd()}/`, "");
if (!PROTECTED.some((re) => re.test(file))) process.exit(0);
const transcript = event.transcript_path ? readFileSync(event.transcript_path, "utf8") : "";
if (transcript.toLowerCase().includes(APPROVAL)) process.exit(0);
console.error(`${file} is a protected path. Ask the user to reply "${APPROVAL}" before editing it.`);
process.exit(2);
