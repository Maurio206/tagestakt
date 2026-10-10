import { handleRevocationHttp } from "@/server/connector/http";

/** RFC 7009: Token-Widerruf. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleRevocationHttp(request);
}
