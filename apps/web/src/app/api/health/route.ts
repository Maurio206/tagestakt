/**
 * Minimaler Health-Endpunkt für Container und Coolify.
 * Bewusst ohne Anmeldung, ohne Datenbankzugriff und ohne Versions-/Konfigurationsdetails.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "tagestakt-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
