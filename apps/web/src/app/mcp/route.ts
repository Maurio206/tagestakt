import { handleMcpHttp } from "@/server/connector/http";

/**
 * Remote-MCP-Endpunkt des Claude-Connectors (Streamable HTTP, zustandslos).
 * Ohne gültiges OAuth-Access-Token: 401 mit Verweis auf die Ressourcen-Metadaten.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleMcpHttp(request);
}

export function GET(request: Request) {
  return handleMcpHttp(request);
}

export function DELETE(request: Request) {
  return handleMcpHttp(request);
}
