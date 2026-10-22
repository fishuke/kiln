import { describe, expect, it } from "vitest";
import { detectSetup, devCommand, envKeys, listenPort } from "./setup";

describe("detecting an imported project's setup", () => {
  it("picks the package manager from the lockfile", () => {
    expect(detectSetup({ files: ["pnpm-lock.yaml"] }).packageManager).toBe("pnpm");
    expect(detectSetup({ files: ["yarn.lock"] }).install).toEqual(["yarn install"]);
    expect(detectSetup({ files: ["bun.lock"] }).packageManager).toBe("bun");
    expect(detectSetup({ files: ["package-lock.json"] }).install).toEqual(["npm install --no-audit --no-fund"]);
  });

  it("installs with npm without writing a lockfile the repository doesn't have", () => {
    expect(detectSetup({ files: [] }).install).toEqual(["npm install --no-audit --no-fund --no-package-lock"]);
  });

  it("runs scripts.dev and passes the port to next and vite", () => {
    expect(detectSetup({ files: [], packageJson: JSON.stringify({ scripts: { dev: "node server.js" } }) }).devDetected).toBe("npm run dev");
    expect(detectSetup({ files: ["pnpm-lock.yaml"], packageJson: JSON.stringify({ scripts: { dev: "next dev --turbopack" } }) }).devDetected).toBe(
      "pnpm run dev --port {port} --hostname 0.0.0.0",
    );
    expect(detectSetup({ files: [], packageJson: JSON.stringify({ scripts: { dev: "vite" } }) }).devDetected).toBe(
      "npm run dev -- --port {port} --host 0.0.0.0",
    );
    expect(detectSetup({ files: [], packageJson: JSON.stringify({ scripts: { dev: "next dev -p 3001" } }) }).devDetected).toBe("npm run dev");
    expect(detectSetup({ files: [], packageJson: "{}" }).devDetected).toBeUndefined();
  });

  it("lists the environment keys an example file asks for", () => {
    expect(envKeys("# comment\nAPI_URL=\nexport SECRET_KEY=x\n\nnot a key\n")).toEqual(["API_URL", "SECRET_KEY"]);
  });

  it("prefers a person's dev command over the detected one", () => {
    expect(devCommand({ devDetected: "npm run dev", devOverride: "node x.js" })).toBe("node x.js");
    expect(devCommand({ devDetected: "npm run dev" })).toBe("npm run dev");
  });

  it("finds the port a dev server says it listens on", () => {
    expect(listenPort("  ▲ Next.js 15  - Local:  http://localhost:3005")).toBe(3005);
    expect(listenPort("listening on 0.0.0.0:8080")).toBe(8080);
    expect(listenPort("compiling…")).toBeUndefined();
  });
});
