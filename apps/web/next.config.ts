import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kiln/sdk-ts"],
  // Loaded by instrumentation-node.ts; they patch Node modules at runtime, so they are not bundled.
  serverExternalPackages: ["@opentelemetry/sdk-node", "@opentelemetry/instrumentation-http", "@opentelemetry/instrumentation-undici"],
};

export default nextConfig;
