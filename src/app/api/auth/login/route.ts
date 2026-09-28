import { verifySignIn, createSessionToken } from "@/lib/sui-auth";
import { sessionSetCookie } from "@/lib/http";

export const runtime = "nodejs";

/** Wallet sign-in: verify the challenge signature and set the session cookie. */
export async function POST(req: Request) {
  let body: { message?: unknown; signature?: unknown; address?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await verifySignIn(body);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 401 });
  }

  return Response.json(
    { address: result.address },
    {
      headers: {
        "Set-Cookie": sessionSetCookie(createSessionToken(result.address)),
      },
    }
  );
}
