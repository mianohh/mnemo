import { fetchOwnedBlobs, isBlobCacheStale } from "./walrus-chain";
import {
  countUnanchored,
  linkOnChainBlobs,
  type ExpirySnapshot,
  type ExpiryEntry,
} from "./store";

/**
 * Reconcile the Postgres mirror with the Walrus Blob objects we own on Sui.
 *
 * Every blob the relayer writes for us is transferred to the MemWal account
 * owner, so the set of owned Blob objects *is* the on-chain truth: it carries
 * the object id (`walrus extend --blob-obj-id …`) and `storage.end_epoch`.
 * The mirror keeps a copy so the dashboard and the alerting path never have to
 * hit the chain on the hot path.
 */
export interface SyncResult {
  fetched: number;
  linked: number;
  error?: string;
  /** Set when Sui was unreachable and the last known blob set was reused. */
  stale?: boolean;
}

export async function syncAnchors(
  opts: { force?: boolean } = {}
): Promise<SyncResult> {
  try {
    const accountId = process.env.MEMWAL_ACCOUNT_ID;
    if (!accountId) {
      return { fetched: 0, linked: 0, error: "MEMWAL_ACCOUNT_ID is not set" };
    }
    const blobs = await fetchOwnedBlobs({ accountId, force: opts.force });
    const linked = await linkOnChainBlobs(
      blobs.map((b) => ({
        blobId: b.blobId,
        objectId: b.objectId,
        startEpoch: b.startEpoch,
        expiryEpoch: b.endEpoch,
      }))
    );
    const stale = isBlobCacheStale();
    return { fetched: blobs.length, linked, ...(stale ? { stale } : {}) };
  } catch (e) {
    return {
      fetched: 0,
      linked: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Only talks to Sui when something is still unresolved — keeps dashboards cheap. */
export async function maybeSyncAnchors(): Promise<SyncResult | null> {
  const pending = await countUnanchored();
  if (pending === 0) return null;
  return syncAnchors();
}

/**
 * Walrus mainnet epoch length. The docs state 14 days; `WALRUS_EPOCH_MS` is
 * an escape hatch if the network retunes it.
 */
const DEFAULT_EPOCH_MS = 14 * 24 * 60 * 60 * 1000;
/** Renewal/review margin: flag blobs this many epochs before their end epoch. */
export const EXPIRY_WARN_EPOCHS = 3;

function walrusEpochMs(): number {
  const raw = Number(process.env.WALRUS_EPOCH_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EPOCH_MS;
}

export interface EpochClock {
  /** Current Walrus epoch. Accurate to about ±1 epoch (≈2 weeks). */
  epoch: number;
  epochMs: number;
  /** Best estimate of when `epoch` began. */
  epochStartAt(epoch: number): number;
  /** Whole epochs left before `expiryEpoch` starts. */
  epochsUntil(expiryEpoch: number): number;
}

/**
 * Turn mirror timestamps into an epoch clock.
 *
 * A blob's `start_epoch` is the epoch it was registered in, and the mirror's
 * `created_at` is the write time inside that epoch — so each epoch we wrote in
 * brackets its own start: `boundary ∈ (previous epoch's last write, this
 * epoch's first write]`. The midpoint is the estimate, and the spacing between
 * boundaries gives the epoch length. No extra chain round trip, and it
 * self-corrects as new memories arrive.
 */
export function buildEpochClock(
  marks: { epoch: number; firstAt: number; lastAt: number }[],
  now = Date.now()
): EpochClock | null {
  if (marks.length === 0) return null;
  const epochMs = walrusEpochMs();
  const sorted = [...marks].sort((a, b) => a.epoch - b.epoch);
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];

  const boundaryOfLatest =
    prev && prev.epoch === latest.epoch - 1
      ? (prev.lastAt + latest.firstAt) / 2
      : latest.firstAt - epochMs / 2;

  const boundary = (target: number) =>
    boundaryOfLatest + (target - latest.epoch) * epochMs;

  const epoch = latest.epoch + Math.floor((now - boundaryOfLatest) / epochMs);

  return {
    epoch,
    epochMs,
    epochStartAt: boundary,
    epochsUntil: (expiryEpoch) => expiryEpoch - epoch,
  };
}

export interface ExpirySummary {
  /** Mirrored blobs with a known end epoch. */
  anchored: number;
  /** Blobs whose Sui object id has not been resolved yet. */
  unanchored: number;
  walrusEpoch: number | null;
  epochLengthDays: number;
  /** End epoch of the soonest-expiring blob (null when nothing is anchored). */
  soonestExpiryEpoch: number | null;
  soonestExpiresAt: string | null;
  /** Whole epochs left before the first blob disappears. */
  epochsRemaining: number | null;
  daysRemaining: number | null;
  /** True when the first blob is within the renewal margin. */
  warn: boolean;
  /** End epochs, ascending, with how many blobs share each. */
  byEpoch: { expiryEpoch: number; blobs: number; epochsRemaining: number }[];
}

export function summariseExpiry(
  snapshot: Pick<ExpirySnapshot, "anchored" | "unanchored" | "anchors" | "minExpiryEpoch">,
  entries: ExpiryEntry[],
  now = Date.now()
): ExpirySummary {
  const clock = buildEpochClock(snapshot.anchors, now);

  const byEpochMap = new Map<number, number>();
  for (const entry of entries) {
    byEpochMap.set(
      entry.expiryEpoch,
      (byEpochMap.get(entry.expiryEpoch) ?? 0) + 1
    );
  }
  const byEpoch = [...byEpochMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([expiryEpoch, blobs]) => ({
      expiryEpoch,
      blobs,
      epochsRemaining: clock ? expiryEpoch - clock.epoch : 0,
    }));

  const soonest = snapshot.minExpiryEpoch;
  const epochsRemaining =
    soonest !== null && clock ? soonest - clock.epoch : null;
  const daysRemaining =
    epochsRemaining !== null
      ? Number(((epochsRemaining * clock!.epochMs) / 86_400_000).toFixed(1))
      : null;

  return {
    anchored: snapshot.anchored,
    unanchored: snapshot.unanchored,
    walrusEpoch: clock ? clock.epoch : null,
    epochLengthDays: Number((walrusEpochMs() / 86_400_000).toFixed(2)),
    soonestExpiryEpoch: soonest,
    soonestExpiresAt:
      soonest !== null && clock
        ? new Date(clock.epochStartAt(soonest)).toISOString()
        : null,
    epochsRemaining,
    daysRemaining,
    warn:
      epochsRemaining !== null && epochsRemaining <= EXPIRY_WARN_EPOCHS,
    byEpoch,
  };
}
