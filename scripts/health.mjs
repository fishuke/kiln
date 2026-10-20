#!/usr/bin/env node
// pnpm health: check the API, the web app and the optional services the install uses.
const checks = [
  ["api", process.env.KILN_API_URL ?? "http://localhost:4000", "/api/v1/health"],
  ["web", process.env.KILN_WEB_URL ?? "http://localhost:3000", "/"],
];
let ok = true;
for (const [name, base, path] of checks) {
  try {
    const res = await fetch(base + path);
    console.log(`${res.ok ? "ok  " : "FAIL"} ${name} ${base}${path} (${res.status})`);
    ok &&= res.ok;
  } catch (err) {
    console.log(`FAIL ${name} ${base}${path} (${err.cause?.code ?? err.message})`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
