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
  // Gemeinsame Pakete werden als TypeScript-Quelltext eingebunden; geist liefert die
  // selbst gehosteten Schriftdateien (keine Anfragen an Drittserver).
  transpilePackages: ["@tagestakt/schedule-schema", "@tagestakt/design-tokens", "geist"],
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
