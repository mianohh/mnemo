import { getMemWal, memoryConfigured, memwalNetwork } from "@/lib/memory/client";
import { pingDatabase } from "@/lib/memory/store";

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

interface HealthBody {
  ok: boolean;
  app: string;
  llm: string;
  memwalConfigured: boolean;
  network: string;
  relayer: { status?: string; version?: string; error?: string };
  database: boolean;
  geminiConfigured: boolean;
  zkLogin: { googleConfigured: boolean; saltConfigured: boolean };
  time: string;
}

let cache: { body: HealthBody; at: number } | null = null;

function withTimeout<T>(task: Promise<T>): Promise<T> {
  return Promise.race([
    task,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("health check timed out")),
        CHECK_TIMEOUT_MS
      );
      (timer as { unref?: () => void }).unref?.();
    }),
  ]);
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

  const [relayer, database] = await Promise.all([
    relayerHealth(memwalConfigured),
    databaseConfigured
      ? withTimeout(pingDatabase()).catch(() => false)
      : Promise.resolve(false),
  ]);

  return {
    ok: true,
    app: "mnemo-ai",
    llm: process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest",
    memwalConfigured,
    network: memwalNetwork(),
    relayer,
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
}

export async function GET() {
  if (!cache || Date.now() - cache.at >= CACHE_TTL_MS) {
    cache = { body: await buildHealth(), at: Date.now() };
  }
  return Response.json(cache.body, {
    headers: { "cache-control": "public, max-age=15" },
  });
}
