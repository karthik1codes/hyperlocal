import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local weblink auth uses 127.0.0.1 (Bento rejects hostname `localhost`).
  allowedDevOrigins: ["127.0.0.1"],

  // sharp (a native binary) feathers the embed-card avatar in app/api/card-image.
  // Marking it external loads it from node_modules at runtime instead of bundling
  // it, so the correct platform binary is used on Vercel.
  serverExternalPackages: ["sharp"],

  async rewrites() {
    // Pretty embed URL: /<id>.png -> the card image route. The id charset is
    // alphanumerics + hyphens (duel / market ids), and it only matches the .png
    // suffix, so this never shadows real static assets in /public. Returned as
    // an afterFiles rewrite (a plain array), so /public files still win over it.
    return [
      { source: "/:username([a-zA-Z0-9-]+).png", destination: "/api/card-image/:username" },
    ];
  },
};

export default nextConfig;
