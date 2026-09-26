import { getMemWal } from "./client";
import { pendingCount } from "./store";
import type { RecalledMemory } from "./types";

const MIN_RELEVANCE = Number(process.env.MEMWAL_MIN_RELEVANCE ?? "0.2");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RecallOutcome {
  memories: RecalledMemory[];
  attempts: number;
  error?: string;
}

/**
 * Semantic recall for one user's namespace.
 *
 * Walrus Memory indexes in the background after a remember() job, so a memory
 * saved moments ago may not be searchable yet. When the mirror shows pending
 * writes for this namespace and recall comes back empty, we retry with a short
 * backoff instead of letting the agent answer "I don't know" about something
 * it just stored.
 */
export async function recallForNamespace(
  namespace: string,
  query: string,
  limit = 6
): Promise<RecallOutcome> {
  const memwal = getMemWal();
  let maxAttempts = 1;
  try {
    maxAttempts = (await pendingCount(namespace)) > 0 ? 3 : 1;
  } catch {
    maxAttempts = 1;
  }
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
      const memories = res.results
        .filter((r) => 1 - r.distance >= MIN_RELEVANCE)
        .slice(0, limit)
        .map<RecalledMemory>((r) => ({
          blobId: r.blob_id,
          text: r.text,
          distance: r.distance,
          createdAt: r.created_at,
        }));
      if (memories.length > 0) {
        return { memories, attempts };
      }
      error = undefined;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (maxAttempts === 1) maxAttempts = 2;
    }
    if (attempts < maxAttempts) await sleep(800 * attempts);
  }

  return { memories: [], attempts, error };
}

export function formatMemoriesForPrompt(
  memories: RecalledMemory[]
): string {
  if (memories.length === 0) return "";
  const bullets = memories
    .map((m) => `- ${m.text} (relevance ${(1 - m.distance).toFixed(2)})`)
    .join("\n");
  return [
    "[Walrus Memory — facts recalled for this user from decentralized storage]",
    bullets,
    "Use these when relevant. Never invent facts that are not on this list. If a recalled fact conflicts with what the user just said, trust the user and update your model of them.",
  ].join("\n");
}
