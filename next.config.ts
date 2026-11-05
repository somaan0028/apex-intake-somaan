import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The public intake form is shown to clients; the dev indicator floats over it
  // and exposes the stack, so turn it off. Compile/runtime errors still surface.
  devIndicators: false,
  // `better-sqlite3` ships a native `.node` binding, so it must be treated as an
  // external package and required at runtime instead of being bundled by Next.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    agentFeedback: true,
    // Profile photos are uploaded through a Server Action. The default request
    // cap is 1 MB, which is below the 5 MB image limit, so leave headroom for
    // the multipart envelope.
    serverActions: {
      bodySizeLimit: "6mb",
    },
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
