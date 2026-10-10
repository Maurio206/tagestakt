import { handleTokenHttp } from "@/server/connector/http";

/** OAuth-Token-Endpunkt (authorization_code mit PKCE, refresh_token mit Rotation). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleTokenHttp(request);
}
