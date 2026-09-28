import { SESSION_COOKIE, readSessionClaims } from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { addressNamespace } from "@/lib/sui";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const claims = readSessionClaims(getRequestCookie(req, SESSION_COOKIE));
  if (!claims) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  return Response.json({
    address: claims.address,
    namespace: addressNamespace(claims.address),
    ...(claims.email ? { email: claims.email } : {}),
  });
}
