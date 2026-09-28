import { prepare, ZkLoginError } from "@/lib/zklogin/server";

export const runtime = "nodejs";

/** OAuth client id needed to build the Google sign-in redirect. */
export async function GET() {
  try {
    return Response.json(await prepare());
  } catch (e) {
    const known = e instanceof ZkLoginError;
    console.error("[mnemo] zklogin prepare failed", e instanceof Error ? e.message : e);
    return Response.json(
      { error: known ? e.message : "zkLogin sign-in is unavailable" },
      { status: known ? e.status : 502 }
    );
  }
}
