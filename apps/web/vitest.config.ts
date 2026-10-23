import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The automatic JSX runtime, as Next.js compiles it (tsconfig keeps JSX for Next).
  esbuild: { jsx: "automatic" },
  test: { environment: "node" },
});
