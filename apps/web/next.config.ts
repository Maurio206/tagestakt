import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

/** Wurzel des pnpm-Monorepos (zwei Ebenen über apps/web), plattformunabhängig. */
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  // Eigenständiger Produktionsserver (apps/web/.next/standalone) für das Docker-Image.
  output: "standalone",
  // Datei-Tracing ab der Monorepo-Wurzel, damit Workspace-Pakete und das
  // gemeinsame node_modules korrekt in den Standalone-Build gelangen.
  outputFileTracingRoot: monorepoRoot,
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
