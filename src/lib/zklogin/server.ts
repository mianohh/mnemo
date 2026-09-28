import { createHmac } from "node:crypto";
import { decodeJwt, jwtToAddress } from "@mysten/sui/zklogin";

/**
 * Email sign-in server support: Google OAuth (authorization code + PKCE),
 * a deterministic salt, and address derivation from the verified JWT.
 *
 * There is no proving service: the server itself exchanges the OAuth code,
 * validates the JWT, and derives the user's Sui address with `jwtToAddress`,
 * so possession of a valid code *is* the proof of identity. The JWT never
 * leaves this server. The same `iss` + `aud` + `sub` + salt always maps to
 * the same address, exactly as zkLogin defines it.
 */

const GOOGLE_ISSUER = "https://accounts.google.com";

/** Expected failure with an HTTP status the route can surface to the client. */
export class ZkLoginError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ZkLoginError";
    this.status = status;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new ZkLoginError(`${name} is not configured`, 503);
  return value;
}

function googleClientId(): string {
  return requiredEnv("GOOGLE_CLIENT_ID");
}

/**
 * Master salt key. Give address derivation its own secret
 * (`ZKLOGIN_SALT_SECRET`) so rotating SESSION_SECRET — which revokes sessions
 * and MCP tokens — does not silently remap every email user to a new address.
 */
function saltSecret(): string {
  const value = process.env.ZKLOGIN_SALT_SECRET ?? process.env.SESSION_SECRET;
  if (!value) throw new ZkLoginError("ZKLOGIN_SALT_SECRET is not configured", 503);
  return value;
}

/** Deterministic per-identity salt: same Google account → same address on every device. */
function deriveSalt(iss: string, aud: string, sub: string): string {
  const mac = createHmac("sha256", saltSecret())
    .update(`mnemo-zklogin-salt:${iss}|${aud}|${sub}`)
    .digest();
  return BigInt(`0x${mac.subarray(0, 16).toString("hex")}`).toString();
}

/** Everything the client needs to start an OAuth redirect (no secrets). */
export function prepare(): { clientId: string } {
  return { clientId: googleClientId() };
}

export interface ExchangeInput {
  code?: unknown;
  codeVerifier?: unknown;
  redirectUri?: unknown;
}

export interface ExchangeResult {
  address: string;
  email?: string;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new ZkLoginError(`${field} is required`);
  }
  return value;
}

/**
 * Validate the OAuth code + PKCE verifier with Google, validate the resulting
 * JWT, and derive the user's address. The client only ever sees the address
 * and email — the JWT stays on this server.
 */
export async function exchange(input: ExchangeInput): Promise<ExchangeResult> {
  const code = asString(input.code, "code");
  const codeVerifier = asString(input.codeVerifier, "codeVerifier");
  const redirectUri = asString(input.redirectUri, "redirectUri");

  const idToken = await exchangeCode(code, codeVerifier, redirectUri);

  let payload: ReturnType<typeof decodeJwt> & { email?: string };
  try {
    payload = decodeJwt(idToken) as ReturnType<typeof decodeJwt> & {
      email?: string;
    };
  } catch {
    throw new ZkLoginError("Google returned an unreadable id_token", 502);
  }

  if (payload.rawIss !== GOOGLE_ISSUER) {
    throw new ZkLoginError("Unexpected token issuer");
  }
  if (payload.aud !== googleClientId()) {
    throw new ZkLoginError("Token was issued for a different client");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    throw new ZkLoginError("Token expired — try again");
  }

  const salt = deriveSalt(payload.iss, payload.aud, payload.sub);
  const address = jwtToAddress(idToken, salt, false);
  const email = typeof payload.email === "string" ? payload.email : undefined;
  return email ? { address, email } : { address };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: googleClientId(),
        client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error(
      "[mnemo] Google token endpoint unreachable:",
      e instanceof Error ? e.message : e
    );
    throw new ZkLoginError("Could not reach Google — try again", 502);
  }
  if (!res.ok) {
    // Never echo the token response; Google's OAuth errors are safe to map.
    const detail = await res.text().catch(() => "");
    console.error("[mnemo] Google token exchange rejected", {
      status: res.status,
      detail: detail.slice(0, 300),
    });
    throw new ZkLoginError(
      res.status === 400 ? "Sign-in code was rejected or already used" : "Google token exchange failed",
      res.status === 400 ? 401 : 502
    );
  }
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") {
    throw new ZkLoginError("Google did not return an id_token", 502);
  }
  return body.id_token;
}
