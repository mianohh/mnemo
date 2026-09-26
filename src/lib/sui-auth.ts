import { createHmac, timingSafeEqual } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { isSuiAddress } from "./sui";

export const SESSION_COOKIE = "mnemo_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNIN_MAX_AGE_MS = 5 * 60 * 1000;

let rpcClient: SuiGrpcClient | undefined;
/** Server-side client — required to verify zkLogin signatures (remote JWK/epoch lookups). */
function suiClient(): SuiGrpcClient {
  rpcClient ??= new SuiGrpcClient({
    network: "mainnet",
    baseUrl: "https://fullnode.mainnet.sui.io:443",
  });
  return rpcClient;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured");
  return value;
}

function signPayload(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Session token: `<address>.<expiresAtMs>.<hmac>` — stateless, httpOnly cookie. */
export function createSessionToken(address: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${address.toLowerCase()}.${expiresAt}`;
  return `${payload}.${signPayload(payload)}`;
}

export function readSessionToken(
  token: string | undefined | null
): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, expiresAtRaw, mac] = parts;
  if (!isSuiAddress(address)) return null;
  const payload = `${address}.${expiresAtRaw}`;
  const expected = signPayload(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(expiresAtRaw) || Number(expiresAtRaw) < Date.now()) {
    return null;
  }
  return address;
}

/**
 * MCP bearer token: `mcp.<address>.<hmac>`.
 *
 * Stateless like the session cookie, but non-expiring and intentionally
 * *not* httpOnly — the owner copies it out of the dashboard into an MCP
 * client. Domain-separated from the session token (payload starts with
 * `mcp.`), so the two can never be swapped for each other. Rotating
 * SESSION_SECRET revokes every issued token.
 */
export function createMcpToken(address: string): string {
  const payload = `mcp.${address.toLowerCase()}`;
  return `${payload}.${signPayload(payload)}`;
}

export function readMcpToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [scheme, address, mac] = parts;
  if (scheme !== "mcp" || !isSuiAddress(address)) return null;
  const normalized = address.toLowerCase();
  const payload = `mcp.${normalized}`;
  const expected = signPayload(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return normalized;
}

/**
 * Verify a wallet sign-in: the signature must be over our exact challenge
 * message (issued within the last 5 minutes) and recover an address.
 */
export async function verifySignIn(body: {
  message?: unknown;
  signature?: unknown;
  address?: unknown;
}): Promise<{ address: string } | { error: string }> {
  const { message, signature } = body;
  if (typeof message !== "string" || typeof signature !== "string") {
    return { error: "message and signature are required" };
  }
  const claimedAddress =
    typeof body.address === "string" && isSuiAddress(body.address)
      ? normalizeSuiAddress(body.address)
      : undefined;

  const bytes = Buffer.from(message, "base64");
  const text = new TextDecoder().decode(bytes);
  const match = text.match(/^Sign in to Mnemo AI\nIssued-At: (\d+)$/);
  if (!match) return { error: "message does not match the sign-in challenge" };
  const issuedAt = Number(match[1]);
  const age = Date.now() - issuedAt;
  if (!Number.isFinite(issuedAt) || age < -60_000 || age > SIGNIN_MAX_AGE_MS) {
    return { error: "sign-in challenge expired" };
  }

  let scheme = "unknown";
  try {
    scheme = parseSerializedSignature(signature).signatureScheme;
  } catch {
    scheme = "unparsable";
  }

  // Verify against the raw challenge bytes first, then the BCS vector<u8>
  // form — some wallets sign the pre-wrapped message while echoing the raw
  // bytes back in `message`. The client (SuiClient) enables zkLogin
  // verification, which needs remote JWK/epoch lookups; passing the claimed
  // address lets legacy zkLogin address derivations resolve and binds the
  // session to exactly the address the wallet reported.
  const candidates = [
    bytes,
    bcs.vector(bcs.u8()).serialize(bytes).toBytes(),
  ];
  for (const candidate of candidates) {
    try {
      const publicKey = await verifyPersonalMessageSignature(
        candidate,
        signature,
        { client: suiClient(), address: claimedAddress }
      );
      return { address: publicKey.toSuiAddress().toLowerCase() };
    } catch {
      /* try next candidate */
    }
  }

  console.error("[mnemo] verifySignIn failed", {
    scheme,
    claimedAddress,
    bytesLen: bytes.length,
    sigLen: signature.length,
    textPreview: JSON.stringify(text),
  });
  return {
    error:
      scheme === "ZkLogin"
        ? "Signature verification failed (zkLogin)."
        : "signature verification failed",
  };
}
