import { SESSION_COOKIE, readSessionToken } from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { addressNamespace } from "@/lib/sui";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const address = readSessionToken(getRequestCookie(req, SESSION_COOKIE));
  if (!address) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  return Response.json({ address, namespace: addressNamespace(address) });
}
