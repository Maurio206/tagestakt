import { handleOAuthMetadata } from "@/server/connector/http";

/** RFC 8414: Metadaten des Autorisierungsservers (Issuer = Origin der Website). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleOAuthMetadata(request);
}

export function OPTIONS(request: Request) {
  return handleOAuthMetadata(request);
}
