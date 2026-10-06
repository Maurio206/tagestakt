import { validateServerConfiguration } from "./config-check";

/** Nur in der Node.js-Runtime verwenden (siehe src/instrumentation.ts). */
export function verifyConfigurationOnStartup(): void {
  // Während `next build` gibt es noch keine Laufzeitkonfiguration.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const problems = validateServerConfiguration({ ...process.env });
  if (problems.length === 0) return;

  console.error(
    `[tagestakt] Konfigurationsfehler:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
  );
  if (process.env.NODE_ENV === "production") {
    console.error("[tagestakt] Start abgebrochen. Siehe docs/deployment-coolify.md.");
    process.exit(1);
  }
}
