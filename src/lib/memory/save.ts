import { getMemWal } from "./client";
import { insertPendingMemory, updateMemoryByJob } from "./store";
import { CATEGORY_PREFIX, type SavedFact } from "./types";

/**
 * Persist extracted facts to Walrus Memory and mirror them locally.
 *
 * - rememberBulk accepts up to 20 items; each returns a job id.
 * - The relayer embeds/encrypts/uploads/indexes asynchronously, so the mirror
 *   row starts as `pending` and is flipped to `done` (with its Walrus blob id)
 *   when the job finishes.
 * - Text is stored with a "Category:" prefix so recall and the dashboard both
 *   understand structure without a separate schema on the Walrus side.
 */
export async function saveFacts(
  namespace: string,
  facts: SavedFact[]
): Promise<{ saved: { jobId: string; text: string }[]; settle: () => Promise<void> }> {
  if (facts.length === 0) return { saved: [], settle: async () => {} };
  const memwal = getMemWal();
  const items = facts.map((f) => ({
    text: `${CATEGORY_PREFIX[f.category]}: ${f.text}`,
    namespace,
  }));

  const { job_ids } = await memwal.rememberBulk(items);

  const saved: { jobId: string; text: string }[] = [];
  for (const [i, jobId] of job_ids.entries()) {
    await insertPendingMemory({
      namespace,
      category: facts[i].category,
      text: items[i].text,
      jobId,
    });
    saved.push({ jobId, text: items[i].text });
  }

  const settle = async () => {
    const results = await Promise.allSettled(
      saved.map(async ({ jobId }) => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await memwal.waitForRememberJob(jobId);
            await updateMemoryByJob(jobId, { status: "done", blobId: result.blob_id });
            return;
          } catch (e) {
            lastError = e;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
          }
        }
        throw lastError;
      })
    );
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        console.error(
          "[mnemo] settle job failed:",
          saved[i].jobId,
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        );
        await updateMemoryByJob(saved[i].jobId, { status: "failed" });
      }
    }
  };

  return { saved, settle };
}

export function settleAfterResponse(settle: () => Promise<void>): void {
  void settle().catch((e) => console.error("[mnemo] settle failed:", e));
}
