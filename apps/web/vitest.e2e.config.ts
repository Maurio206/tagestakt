import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Datenbank-E2E-Tests des Claude-Connectors – ausschließlich gegen die lokale Supabase-Instanz.
 * Start über `pnpm connector:e2e` (scripts/connector-e2e-test.mjs), nie direkt gegen Produktion.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.e2e.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
