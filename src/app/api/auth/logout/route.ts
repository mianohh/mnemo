import { sessionClearCookie } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionClearCookie() } }
  );
}
