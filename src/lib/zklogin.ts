import { apiFetch } from "@/lib/api";

/**
 * Browser side of the email sign-in.
 *
 * A PKCE attempt (state + code verifier) lives in sessionStorage only for the
 * duration of the OAuth round trip. Identity comes back with the session
 * cookie set by the exchange — no keys, proofs, or caches to manage.
 */

const PENDING_KEY = "mnemo:zklogin:pending";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

interface PendingZkLogin {
  state: string;
  codeVerifier: string;
}

export interface ZkLoginIdentity {
  address: string;
  email?: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — the flow still works within this page */
  }
}

function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Start the Google OAuth redirect. Never resolves under normal operation —
 * the browser navigates away and `/auth/callback` finishes the sign-in.
 */
export async function beginZkLogin(): Promise<void> {
  const res = await apiFetch("/api/auth/zklogin/prepare");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Sign-in unavailable (${res.status})`);
  }
  const { clientId } = (await res.json()) as { clientId: string };

  const pending: PendingZkLogin = {
    state: randomBase64Url(32),
    codeVerifier: randomBase64Url(64),
  };
  writeJson(PENDING_KEY, pending);

  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state: pending.state,
    code_challenge: await pkceChallenge(pending.codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  // External navigation to Google's OAuth endpoint (not an app route).
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Finish an OAuth redirect: validate `state`, exchange the code server-side,
 * and read back the identity (the session cookie rides on the response).
 */
export async function completeZkLogin(params: {
  code?: string | null;
  state?: string | null;
}): Promise<ZkLoginIdentity> {
  const pending = readJson<PendingZkLogin>(PENDING_KEY);
  remove(PENDING_KEY);
  if (!pending) throw new Error("Sign-in session expired — please try again");
  if (!params.code) throw new Error("Google did not return a sign-in code");
  if (!params.state || params.state !== pending.state) {
    throw new Error("Sign-in response could not be verified — please try again");
  }

  const res = await apiFetch("/api/auth/zklogin/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: params.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: `${window.location.origin}/auth/callback`,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Sign-in failed (${res.status})`);
  }
  const identity = (await res.json()) as ZkLoginIdentity;
  if (!identity.address) throw new Error("Sign-in failed");
  return identity;
}

export function clearZkLoginCache(): void {
  remove(PENDING_KEY);
}
