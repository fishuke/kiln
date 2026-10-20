import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/api/src/**/*.test.ts", "apps/mcp/src/**/*.test.ts", "e2e/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
