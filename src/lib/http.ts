import { SESSION_COOKIE } from "./sui-auth";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Session cookie attributes. In production the frontend (Vercel) and the API
 * (Render) are cross-site, so the cookie must be SameSite=None; Secure — that
 * combination also works same-site. `Partitioned` keeps the cookie usable if
 * browsers phase out unrestricted third-party cookies. Local dev is same-site
 * (localhost) and stays on Lax.
 */
function attrs(): string {
  if (process.env.NODE_ENV === "production") {
    return `Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=None; Secure; Partitioned`;
  }
  return `Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax`;
}

export function sessionSetCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${attrs()}`;
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; ${attrs().replace(`Max-Age=${SESSION_MAX_AGE}`, "Max-Age=0")}`;
}

export function getRequestCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
