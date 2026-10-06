import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Das gemeinsame Paket wird als TypeScript-Quelltext eingebunden.
  transpilePackages: ["@tagestakt/schedule-schema"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
