import { SESSION_COOKIE, readSessionToken } from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { cachedOwner } from "@/lib/memory/walrus-chain";
import {
  expirySnapshot,
  listExpiries,
  listUnanchoredSample,
} from "@/lib/memory/store";
import {
  EXPIRY_WARN_EPOCHS,
  buildEpochClock,
  syncAnchors,
  summariseExpiry,
} from "@/lib/memory/anchor";

export const runtime = "nodejs";

/**
 * Walrus blobs lapse at a fixed end epoch and cannot be renewed afterwards, so
 * this is the one endpoint a cron must be able to reach without a browser
 * session. It reconciles the mirror against Sui and reports how much life is
 * left in every blob we hold.
 *
 * Auth: a signed-in session (dashboard use) or `Authorization: Bearer
 * $CRON_SECRET` when CRON_SECRET is set.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (secret && header === `Bearer ${secret}`) return true;
  return Boolean(readSessionToken(getRequestCookie(req, SESSION_COOKIE)));
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "Not authorized" }, { status: 401 });
  }

  // Always reconcile on this path: expiry data is worthless if it is stale.
  const sync = await syncAnchors({ force: true });

  let snapshot;
  let entries;
  let unlinked: string[] = [];
  try {
    snapshot = await expirySnapshot();
    entries = await listExpiries();
    unlinked = await listUnanchoredSample();
  } catch {
    return Response.json(
      { error: "Database unavailable", sync },
      { status: 503 }
    );
  }

  const summary = summariseExpiry(snapshot, entries);
  const clock = buildEpochClock(snapshot.anchors);

  const blobs = entries
    .map((entry) => ({
      ...entry,
      epochsRemaining: clock ? clock.epochsUntil(entry.expiryEpoch) : null,
      expiresAt: clock
        ? new Date(clock.epochStartAt(entry.expiryEpoch)).toISOString()
        : null,
      warn: clock ? clock.epochsUntil(entry.expiryEpoch) <= EXPIRY_WARN_EPOCHS : false,
    }))
    .sort((a, b) => a.expiryEpoch - b.expiryEpoch);

  return Response.json({
    ...summary,
    // `unlinked` is the diagnostic for a sync that found blobs but matched
    // none of them: compare those mirror ids against the chain's base64url
    // ids to see whether the two sides spell the same blob differently.
    sync: { ...sync, unlinked },
    // Renewal is only possible before the end epoch, and only from the wallet
    // that owns the Blob objects — this hands a caller exactly that list.
    renewWith: {
      owner: cachedOwner() ?? process.env.MEMWAL_OWNER_ADDRESS ?? null,
      command: "walrus extend --blob-obj-id <blob_object_id> --epochs-extended <n>",
      objects: blobs.slice(0, 50).map((b) => b.objectId),
    },
    blobs,
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
