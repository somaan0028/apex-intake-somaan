import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // `better-sqlite3` ships a native `.node` binding, so it must be treated as an
  // external package and required at runtime instead of being bundled by Next.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
