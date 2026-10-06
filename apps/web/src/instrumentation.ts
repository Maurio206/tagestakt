/**
 * Wird von Next.js einmal beim Serverstart ausgeführt.
 *
 * In Produktion bricht der Start mit einer klaren Meldung ab, wenn die
 * Konfiguration unvollständig ist (z. B. TAGESTAKT_OWNER_USER_ID fehlt).
 * So läuft die App nie in einem unsicheren Zustand an.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { verifyConfigurationOnStartup } = await import("./server/startup-check");
    verifyConfigurationOnStartup();
  }
}
