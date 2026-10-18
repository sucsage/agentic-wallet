import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native canvas (PDF pages rendered for watermarked previews) loads from node_modules at run time.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
