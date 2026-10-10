import { handleOAuthMetadata } from "@/server/connector/http";

/** RFC 9728: Metadaten der geschützten Ressource `/mcp`. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return handleOAuthMetadata(request);
}

export function OPTIONS(request: Request) {
  return handleOAuthMetadata(request);
}
