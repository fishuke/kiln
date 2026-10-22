import type { NextConfig } from "next";

// Studio shows this app through its preview proxy at <target>.<KILN_STUDIO_PREVIEW_DOMAIN>.
// Next.js blocks cross-origin requests for dev resources (hot reload), so allow those hosts.
const previewDomain = process.env.KILN_STUDIO_PREVIEW_DOMAIN?.replace(/:\d+$/, "");

const nextConfig: NextConfig = {
  ...(previewDomain ? { allowedDevOrigins: [`*.${previewDomain}`] } : {}),
};

export default nextConfig;
