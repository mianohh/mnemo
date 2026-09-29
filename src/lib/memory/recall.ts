import { getMemWal } from "./client";
import { countMemories, pendingCount } from "./store";
import type { RecalledMemory } from "./types";

const MIN_RELEVANCE = Number(process.env.MEMWAL_MIN_RELEVANCE ?? "0.2");
// When every hit falls below MIN_RELEVANCE (e.g. the meta-query "what do you
// remember about me?" scores ~0.15 against short profile facts), surface the
// nearest few instead of claiming amnesia. Results are namespace-scoped, so
// these are always the user's own memories, already ranked by the relayer.
const FALLBACK_COUNT = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RecallOutcome {
  memories: RecalledMemory[];
  attempts: number;
  error?: string;
}

/**
 * Semantic recall for one user's namespace.
 *
 * Two failure modes are handled so the agent never answers "I don't know"
 * about something it just stored:
 *
 * 1. Index lag — Walrus Memory indexes in the background after a remember()
 *    job, so recall can come back empty while the mirror already has rows.
 *    We retry with a short backoff instead of failing immediately.
 * 2. Relevance floor — meta-queries like "what do you remember about me?"
 *    score below MIN_RELEVANCE against short profile facts. When every hit
 *    is filtered out, the nearest few are returned as a fallback (results
 *    are namespace-scoped, so they are always the user's own memories).
 */
export async function recallForNamespace(
  namespace: string,
  query: string,
  limit = 6
): Promise<RecallOutcome> {
  const memwal = getMemWal();
  let pending = 0;
  let rows = 0;
  try {
    [pending, rows] = await Promise.all([
      pendingCount(namespace),
      countMemories(namespace),
    ]);
  } catch {
    // Mirror unavailable: fall through with a single attempt.
  }
  // Retry when a save is still settling, or when the mirror knows this
  // namespace has memories but the relayer's background index hasn't caught
  // up yet (raw recall returns [] for a short window after job-done).
  const mayIndex = pending > 0 || rows > 0;
  let maxAttempts = mayIndex ? 3 : 1;
  let attempts = 0;
  let error: string | undefined;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const res = await memwal.recall({
        query,
        namespace,
        limit: limit + 4,
      });
      if (res.results.length === 0) {
        if (mayIndex && attempts < maxAttempts) {
          error = undefined;
          await sleep(800 * attempts);
          continue;
        }
        error = undefined;
      } else {
        const passing = res.results.filter(
          (r) => 1 - r.distance >= MIN_RELEVANCE
        );
        const memories = (passing.length > 0 ? passing : res.results)
          .slice(0, passing.length > 0 ? limit : FALLBACK_COUNT)
          .map<RecalledMemory>((r) => ({
            blobId: r.blob_id,
            text: r.text,
            distance: r.distance,
            createdAt: r.created_at,
          }));
        return { memories, attempts };
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (maxAttempts === 1) maxAttempts = 2;
      if (attempts < maxAttempts) await sleep(800 * attempts);
    }
  }

  return { memories: [], attempts, error };
}

