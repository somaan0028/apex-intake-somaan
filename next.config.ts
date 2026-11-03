import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // `better-sqlite3` ships a native `.node` binding, so it must be treated as an
  // external package and required at runtime instead of being bundled by Next.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    agentFeedback: true,
    // The authenticated shell is session-gated, so it can never produce an
    // instant shell; automatic validation would flag it on every dev page load
    // (the route redirects to /login mid-validation). Validate only segments
    // that explicitly opt in with `export const instant`.
    instantInsights: {
      validationLevel: "manual-warning",
    },
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
