import { getMemWal, memoryConfigured, memwalNetwork } from "@/lib/memory/client";
import { pingDatabase, expirySnapshot } from "@/lib/memory/store";
import {
  chainExpiryContext,
  summariseExpiry,
  type ExpirySummary,
} from "@/lib/memory/anchor";

export const runtime = "nodejs";

/**
 * Checks run concurrently with a hard budget so a cold or slow dependency
 * (relayer RTT, first Postgres pool checkout) can't stretch the response.
 * The whole payload is memoized for 15s: the landing page, Render's own
 * health checks and the keep-alive cron all hit this route, and on a
 * free-tier cold start they should share one wake instead of queueing.
 * In-process cache — a sleeping instance still has to boot to serve it,
 * so the cron ping keeps working as a wake-up call.
 */
const CHECK_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 15_000;
const AUTH_TIMEOUT_MS = 5_000;
const AUTH_CACHE_TTL_MS = 5 * 60_000;

interface HealthBody {
  ok: boolean;
  app: string;
  llm: string;
  memwalConfigured: boolean;
  network: string;
  /**
   * `auth` answers a different question than `status`: health() is
   * unauthenticated, so it proves the relayer is up, not that *our* delegate
   * key is accepted. true/false/null = accepted / rejected / not measured.
   */
  relayer: {
    status?: string;
    version?: string;
    error?: string;
    auth?: boolean | null;
  };
  database: boolean;
  /** Walrus blob lifetime — lapsed blobs are unrecoverable, so surface it here. */
  walrus?: Pick<
    ExpirySummary,
    | "anchored"
    | "unanchored"
    | "chainBlobs"
    | "epochSource"
    | "walrusEpoch"
    | "soonestExpiryEpoch"
    | "epochsRemaining"
    | "warn"
  >;
  geminiConfigured: boolean;
  zkLogin: { googleConfigured: boolean; saltConfigured: boolean };
  time: string;
}

let cache: { body: HealthBody; at: number } | null = null;

function withTimeout<T>(
  task: Promise<T>,
  budgetMs: number = CHECK_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("health check timed out")),
        budgetMs
      );
      (timer as { unref?: () => void }).unref?.();
    }),
  ]);
}

let authCache: { value: boolean | null; at: number } | null = null;
let authInFlight: Promise<boolean | null> | null = null;

async function measureRelayerAuth(): Promise<boolean | null> {
  try {
    await withTimeout(
      getMemWal().listNamespaces({ limit: 1 }),
      AUTH_TIMEOUT_MS
    );
    return true;
  } catch (e) {
    const status = (e as { status?: number })?.status;
    const message = e instanceof Error ? e.message : String(e);
    return status === 401 || /AUTH_REJECTED|unauthorized/i.test(message)
      ? false
      : null;
  }
}

/**
 * Signed round-trip (`listNamespaces`) — the cheapest call that actually
 * exercises the delegate key. `health()` itself is unauthenticated, so
 * without this a rotated or mis-pasted MEMWAL_PRIVATE_KEY shows up only as
 * silent 401s on recall/save; `auth` answers that question directly:
 * true/false/null = accepted / rejected / not measured.
 *
 * Deliberately non-blocking: the relayer's first RTT from a cold instance
 * routinely costs ~2.5s, and the landing page, Render's health checks and the
 * keep-alive cron all read this route. It returns whatever is cached (stale
 * value, or null before the first measurement) and refreshes in the
 * background on a five-minute TTL.
 */
function relayerAuth(enabled: boolean): boolean | null {
  if (!enabled) return null;
  if (authCache && Date.now() - authCache.at < AUTH_CACHE_TTL_MS) {
    return authCache.value;
  }
  if (!authInFlight) {
    authInFlight = measureRelayerAuth()
      .then((value) => {
        authCache = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        authInFlight = null;
      });
  }
  return authCache ? authCache.value : null;
}

async function relayerHealth(
  enabled: boolean
): Promise<HealthBody["relayer"]> {
  if (!enabled) return {};
  try {
    const health = await withTimeout(getMemWal().health());
    return { status: health.status, version: health.version };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function buildHealth(): Promise<HealthBody> {
  const memwalConfigured = memoryConfigured();
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  const walrusTask = databaseConfigured
    ? Promise.all([
        withTimeout(expirySnapshot()),
        // Chain numbers decide what actually expires. Without them an uptime
        // monitor would read a mirror-only "nothing linked, nothing at risk"
        // on a deploy whose mirror rows have never been resolved on Sui.
        withTimeout(chainExpiryContext()).catch(() => null),
      ])
        .then(([snapshot, chain]) => {
          const {
            anchored,
            unanchored,
            chainBlobs,
            epochSource,
            walrusEpoch,
            soonestExpiryEpoch,
            epochsRemaining,
            warn,
          } = summariseExpiry(snapshot, [], { chain });
          return {
            anchored,
            unanchored,
            chainBlobs,
            epochSource,
            walrusEpoch,
            soonestExpiryEpoch,
            epochsRemaining,
            warn,
          };
        })
        .catch(() => undefined)
    : Promise.resolve(undefined);

  const [relayer, database, walrus] = await Promise.all([
    relayerHealth(memwalConfigured),
    databaseConfigured
      ? withTimeout(pingDatabase()).catch(() => false)
      : Promise.resolve(false),
    walrusTask,
  ]);
  // Sync: returns the cached verdict and refreshes it in the background.
  const auth = relayerAuth(memwalConfigured);

  const body: HealthBody = {
    ok: true,
    app: "mnemo-ai",
    llm: process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest",
    memwalConfigured,
    network: memwalNetwork(),
    relayer: { ...relayer, auth },
    database,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    zkLogin: {
      googleConfigured: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      saltConfigured: Boolean(
        process.env.ZKLOGIN_SALT_SECRET ?? process.env.SESSION_SECRET
      ),
    },
    time: new Date().toISOString(),
  };
  if (walrus) body.walrus = walrus;
  return body;
}

export async function GET() {
  if (!cache || Date.now() - cache.at >= CACHE_TTL_MS) {
    cache = { body: await buildHealth(), at: Date.now() };
  }
  return Response.json(cache.body, {
    headers: { "cache-control": "public, max-age=15" },
  });
}
