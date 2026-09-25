import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@prepkit/shared"],
  // Same-origin API: the session cookie is first-party and no CORS is needed.
  rewrites: async () => [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }],
};

export default nextConfig;
