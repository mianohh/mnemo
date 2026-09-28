import { exchange, ZkLoginError } from "@/lib/zklogin/server";
import { createSessionToken, normalizeEmail } from "@/lib/sui-auth";
import { sessionSetCookie } from "@/lib/http";

export const runtime = "nodejs";

/**
 * OAuth code + PKCE → verified JWT → deterministic zkLogin address, and the
 * session cookie for that address. The JWT never leaves this server; the
 * client receives only the address and email.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const identity = await exchange(body);
    const email = normalizeEmail(identity.email);
    return Response.json(
      { address: identity.address, ...(email ? { email } : {}) },
      {
        headers: {
          "Set-Cookie": sessionSetCookie(createSessionToken(identity.address, email)),
        },
      }
    );
  } catch (e) {
    if (e instanceof ZkLoginError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    console.error("[mnemo] zklogin exchange failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
