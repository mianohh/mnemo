import { Pool, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import { normalizeBlobId } from "./walrus-chain";
import type { Category, MemoryStatus, MirrorMemory } from "./types";
import type {
  ChatUIMessage,
  ConversationDetail,
  ConversationSummary,
} from "../chat-types";

/** One on-chain anchor per memory: the Walrus Blob object and its lifetime. */
export interface BlobAnchor {
  blobId: string;
  objectId: string;
  startEpoch: number;
  expiryEpoch: number;
}

export interface ExpirySnapshot {
  /** Mirror rows that carry a Walrus blob id. */
  blobRows: number;
  /** …of which the on-chain Blob object has been resolved. */
  anchored: number;
  unanchored: number;
  /** Null until at least one blob has been resolved from Sui. */
  minExpiryEpoch: number | null;
  maxStartEpoch: number | null;
  /** Distinct (start epoch, first/last write) marks, oldest first — epoch clock. */
  anchors: { epoch: number; firstAt: number; lastAt: number }[];
}

/** One distinct blob and the epoch it lapses at. */
export interface ExpiryEntry {
  blobId: string;
  objectId: string;
  namespace: string;
  expiryEpoch: number;
}

// One pool per warm process. Stored on globalThis so local dev (HMR) does not
// leak connections across reloads. The API runs as one long-lived Render
// service, so the single pool is reused across requests; the mirror lives in
// Postgres, never in the container filesystem.
const globalStore = globalThis as unknown as {
  __mnemoPool?: Pool;
  __mnemoSchema?: Promise<void>;
};

function getPool(): Pool {
  if (globalStore.__mnemoPool) return globalStore.__mnemoPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set: point it at a Postgres database and export DATABASE_URL (see .env.example)"
    );
  }
  // `pg` honours `?sslmode=…` on the URL, which hosted providers set themselves.
  const pool = new Pool({ connectionString: url, max: 5 });
  pool.on("error", (err) => console.error("[mnemo] postgres pool error:", err));
  globalStore.__mnemoPool = pool;
  return pool;
}

function ensureSchema(): Promise<void> {
  if (!globalStore.__mnemoSchema) {
    const pending = getPool()
      .query(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        category TEXT NOT NULL,
        text TEXT NOT NULL,
        blob_id TEXT,
        job_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_job ON memories(job_id);
      -- On-chain Walrus anchor: which Blob object holds this memory and until
      -- what epoch. Added after the table already existed in production, so
      -- CREATE TABLE IF NOT EXISTS alone would never introduce them.
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS blob_object_id TEXT;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS blob_start_epoch BIGINT;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS blob_expiry_epoch BIGINT;
      CREATE INDEX IF NOT EXISTS idx_memories_expiry
        ON memories(blob_expiry_epoch) WHERE blob_expiry_epoch IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_memories_unanchored
        ON memories(created_at DESC) WHERE blob_id IS NOT NULL AND blob_object_id IS NULL;
      -- Chat history: one row per conversation, the whole thread as a JSONB
      -- snapshot so a turn (or a regenerate) rewrites the row idempotently.
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        title TEXT NOT NULL,
        messages JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_namespace
        ON conversations(namespace, updated_at DESC);
    `).then(() => undefined);
    globalStore.__mnemoSchema = pending;
    // A rejected first attempt must not poison the cache: drop it so the next
    // request retries instead of failing for the life of the process.
    pending.catch(() => {
      if (globalStore.__mnemoSchema === pending) globalStore.__mnemoSchema = undefined;
    });
  }
  return globalStore.__mnemoSchema;
}

async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

async function exec(text: string, params: unknown[] = []): Promise<number> {
  await ensureSchema();
  const res = await getPool().query(text, params);
  return res.rowCount ?? 0;
}

interface Row extends QueryResultRow {
  id: string;
  namespace: string;
  category: Category;
  text: string;
  blob_id: string | null;
  job_id: string | null;
  status: MemoryStatus;
  created_at: Date | string;
  blob_object_id: string | null;
  blob_start_epoch: number | string | null;
  blob_expiry_epoch: number | string | null;
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMemory(row: Row): MirrorMemory {
  return {
    id: row.id,
    namespace: row.namespace,
    category: row.category,
    text: row.text,
    blobId: row.blob_id,
    jobId: row.job_id,
    status: row.status,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
    blobObjectId: row.blob_object_id ?? null,
    blobStartEpoch: toNumberOrNull(row.blob_start_epoch ?? null),
    blobExpiryEpoch: toNumberOrNull(row.blob_expiry_epoch ?? null),
  };
}

export async function insertPendingMemory(input: {
  namespace: string;
  category: Category;
  text: string;
  jobId?: string | null;
}): Promise<MirrorMemory> {
  const row: Row = {
    id: randomUUID(),
    namespace: input.namespace,
    category: input.category,
    text: input.text,
    blob_id: null,
    job_id: input.jobId ?? null,
    status: "pending",
    created_at: new Date().toISOString(),
    blob_object_id: null,
    blob_start_epoch: null,
    blob_expiry_epoch: null,
  };
  await query(
    `INSERT INTO memories (id, namespace, category, text, blob_id, job_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.id,
      row.namespace,
      row.category,
      row.text,
      row.blob_id,
      row.job_id,
      row.status,
      row.created_at,
    ]
  );
  return toMemory(row);
}

export async function updateMemoryByJob(
  jobId: string,
  patch: { status: MemoryStatus; blobId?: string | null }
): Promise<void> {
  await query(
    `UPDATE memories SET status = $1, blob_id = COALESCE($2, blob_id) WHERE job_id = $3`,
    [patch.status, patch.blobId ?? null, jobId]
  );
}

/**
 * Attach on-chain identity and lifetime to mirror rows. Runs as one set-based
 * UPDATE so a full 147-blob reconciliation is a single round trip, and it only
 * touches rows whose stored anchor actually changed.
 */
export async function linkOnChainBlobs(anchors: BlobAnchor[]): Promise<number> {
  if (anchors.length === 0) return 0;
  return exec(
    `UPDATE memories AS m
     SET blob_object_id = x.object_id,
         blob_start_epoch = x.start_epoch,
         blob_expiry_epoch = x.expiry_epoch
     FROM unnest($1::text[], $2::text[], $3::int[], $4::int[])
       AS x(blob_id, object_id, start_epoch, expiry_epoch)
     WHERE m.blob_id = x.blob_id
       AND (m.blob_object_id IS DISTINCT FROM x.object_id
         OR m.blob_start_epoch IS DISTINCT FROM x.start_epoch
         OR m.blob_expiry_epoch IS DISTINCT FROM x.expiry_epoch)`,
    [
      anchors.map((a) => a.blobId),
      anchors.map((a) => a.objectId),
      anchors.map((a) => a.startEpoch),
      anchors.map((a) => a.expiryEpoch),
    ]
  );
}

/**
 * Second pass for rows the exact match missed: canonicalize both sides in JS
 * and update the pairs that now agree. Only ever sees rows that are still
 * unanchored after `linkOnChainBlobs`, so a mirror written in a foreign id
 * format (decimal, hex, padded base64) still gets its object id and lifetime.
 */
export async function linkNormalizedAnchors(
  anchors: BlobAnchor[],
  limit = 2000
): Promise<number> {
  if (anchors.length === 0) return 0;
  const rows = await query<{ id: string; blob_id: string }>(
    `SELECT id, blob_id FROM memories
     WHERE blob_id IS NOT NULL AND blob_object_id IS NULL
     LIMIT $1`,
    [limit]
  );
  if (rows.length === 0) return 0;

  const byId = new Map<string, BlobAnchor>();
  for (const anchor of anchors) {
    const key = normalizeBlobId(anchor.blobId);
    if (!byId.has(key)) byId.set(key, anchor);
  }

  const ids: string[] = [];
  const objectIds: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (const row of rows) {
    const anchor = byId.get(normalizeBlobId(row.blob_id));
    if (!anchor) continue;
    ids.push(row.id);
    objectIds.push(anchor.objectId);
    starts.push(anchor.startEpoch);
    ends.push(anchor.expiryEpoch);
  }
  if (ids.length === 0) return 0;

  return exec(
    `UPDATE memories AS m
     SET blob_object_id = x.object_id,
         blob_start_epoch = x.start_epoch,
         blob_expiry_epoch = x.expiry_epoch
     FROM unnest($1::text[], $2::text[], $3::int[], $4::int[])
       AS x(id, object_id, start_epoch, expiry_epoch)
     WHERE m.id = x.id`,
    [ids, objectIds, starts, ends]
  );
}

/** Mirror rows whose blob id has not been resolved to a Sui object yet. */
export async function countUnanchored(): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM memories
     WHERE blob_id IS NOT NULL AND blob_object_id IS NULL`
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * A few of those ids, newest first. When the Sui sync reports `linked: 0`
 * against a non-empty mirror, these are the strings to compare against the
 * chain's base64url ids — the fastest way to spot an encoding mismatch.
 */
export async function listUnanchoredSample(limit = 5): Promise<string[]> {
  const rows = await query<{ blob_id: string }>(
    `SELECT blob_id FROM memories
     WHERE blob_id IS NOT NULL AND blob_object_id IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.blob_id);
}

/**
 * Account-wide Walrus lifetime picture: how many blobs are known, how many are
 * anchored on Sui, and the (epoch, first-write) pairs that let a caller turn
 * "expiry epoch 47" into a date without talking to the chain again.
 */
export async function expirySnapshot(): Promise<ExpirySnapshot> {
  const [summary] = await query<{
    blob_rows: string;
    anchored: string;
    unanchored: string;
    min_expiry: string | null;
    max_start: string | null;
  }>(
    `SELECT COUNT(*) FILTER (WHERE blob_id IS NOT NULL) AS blob_rows,
            COUNT(*) FILTER (WHERE blob_object_id IS NOT NULL) AS anchored,
            COUNT(*) FILTER (WHERE blob_id IS NOT NULL
                              AND blob_object_id IS NULL) AS unanchored,
            MIN(blob_expiry_epoch) AS min_expiry,
            MAX(blob_start_epoch) AS max_start
     FROM memories`
  );

  const anchorRows = await query<{
    epoch: string;
    first_at: Date | string;
    last_at: Date | string;
  }>(
    `SELECT blob_start_epoch AS epoch,
            MIN(created_at) AS first_at,
            MAX(created_at) AS last_at
     FROM memories
     WHERE blob_start_epoch IS NOT NULL
     GROUP BY 1
     ORDER BY 1`
  );

  const toMs = (value: Date | string) =>
    typeof value === "string" ? Date.parse(value) : value.getTime();

  return {
    blobRows: Number(summary?.blob_rows ?? 0),
    anchored: Number(summary?.anchored ?? 0),
    unanchored: Number(summary?.unanchored ?? 0),
    minExpiryEpoch:
      summary?.min_expiry === null || summary?.min_expiry === undefined
        ? null
        : Number(summary.min_expiry),
    maxStartEpoch:
      summary?.max_start === null || summary?.max_start === undefined
        ? null
        : Number(summary.max_start),
    anchors: anchorRows.map((r) => ({
      epoch: Number(r.epoch),
      firstAt: toMs(r.first_at),
      lastAt: toMs(r.last_at),
    })),
  };
}

/** Distinct blobs with a known end epoch — one row per blob, newest write wins. */
export async function listExpiries(): Promise<ExpiryEntry[]> {
  const rows = await query<{
    blob_id: string;
    blob_object_id: string;
    namespace: string;
    blob_expiry_epoch: string | number;
  }>(
    `SELECT DISTINCT ON (blob_id)
            blob_id, blob_object_id, namespace, blob_expiry_epoch
     FROM memories
     WHERE blob_object_id IS NOT NULL AND blob_expiry_epoch IS NOT NULL
     ORDER BY blob_id, created_at DESC`
  );
  return rows.map((r) => ({
    blobId: r.blob_id,
    objectId: r.blob_object_id,
    namespace: r.namespace,
    expiryEpoch: Number(r.blob_expiry_epoch),
  }));
}

export async function listMemories(namespace: string): Promise<MirrorMemory[]> {
  const rows = await query<Row>(
    `SELECT * FROM memories WHERE namespace = $1 ORDER BY created_at DESC`,
    [namespace]
  );
  return rows.map(toMemory);
}

export async function countMemories(namespace: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM memories WHERE namespace = $1`,
    [namespace]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countByCategory(
  namespace: string
): Promise<Record<Category, number>> {
  const rows = await query<{ category: Category; n: string }>(
    `SELECT category, COUNT(*) AS n FROM memories WHERE namespace = $1 GROUP BY category`,
    [namespace]
  );
  const out = {
    project: 0,
    constraint: 0,
    decision: 0,
    preference: 0,
  } as Record<Category, number>;
  for (const r of rows) out[r.category] = Number(r.n);
  return out;
}

export async function pendingCount(namespace: string): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM memories WHERE namespace = $1 AND status = 'pending'`,
    [namespace]
  );
  return Number(rows[0]?.n ?? 0);
}

// --- Chat history -----------------------------------------------------------

/** Newest-first conversation summaries for one namespace (no message bodies). */
export async function listConversations(
  namespace: string,
  limit = 50
): Promise<ConversationSummary[]> {
  const rows = await query<{
    id: string;
    title: string;
    updated_at: Date | string;
    n: string | number;
  }>(
    `SELECT id, title, updated_at, jsonb_array_length(messages) AS n
     FROM conversations
     WHERE namespace = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [namespace, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    updatedAt: toIso(r.updated_at),
    messageCount: Number(r.n),
  }));
}

/** One conversation's full thread, scoped to the caller's namespace. */
export async function getConversation(
  namespace: string,
  id: string
): Promise<ConversationDetail | null> {
  const rows = await query<{
    id: string;
    title: string;
    messages: ChatUIMessage[] | string;
    updated_at: Date | string;
    n: string | number;
  }>(
    `SELECT id, title, messages, updated_at, jsonb_array_length(messages) AS n
     FROM conversations
     WHERE id = $1 AND namespace = $2`,
    [id, namespace]
  );
  const row = rows[0];
  if (!row) return null;
  const messages =
    typeof row.messages === "string"
      ? (JSON.parse(row.messages) as ChatUIMessage[])
      : row.messages;
  return {
    id: row.id,
    title: row.title,
    updatedAt: toIso(row.updated_at),
    messageCount: Number(row.n),
    messages,
  };
}

/**
 * Idempotent snapshot write: one row per conversation, rewritten wholesale on
 * every turn so retries/regenerates cannot double-append. A missing or
 * foreign-owned `id` falls through to a fresh insert (never reusing an id
 * that is not this namespace's).
 */
export async function saveConversationSnapshot(input: {
  id?: string | null;
  namespace: string;
  title: string;
  messages: ChatUIMessage[];
}): Promise<string> {
  if (input.id) {
    const updated = await exec(
      `UPDATE conversations
       SET title = $1, messages = $2, updated_at = now()
       WHERE id = $3 AND namespace = $4`,
      [input.title, JSON.stringify(input.messages), input.id, input.namespace]
    );
    if (updated > 0) return input.id;
  }
  const id = randomUUID();
  await query(
    `INSERT INTO conversations (id, namespace, title, messages)
     VALUES ($1, $2, $3, $4)`,
    [id, input.namespace, input.title, JSON.stringify(input.messages)]
  );
  return id;
}

export async function deleteConversation(
  namespace: string,
  id: string
): Promise<number> {
  return exec(`DELETE FROM conversations WHERE id = $1 AND namespace = $2`, [
    id,
    namespace,
  ]);
}

export async function deleteAllConversations(namespace: string): Promise<number> {
  return exec(`DELETE FROM conversations WHERE namespace = $1`, [namespace]);
}

/**
 * The full Postgres wipe: every mirror row (memories + conversations) for one
 * namespace. On-chain Walrus blobs are deliberately untouched — they are not
 * deletable through memwal and keep their own epoch expiry.
 */
export async function wipeNamespaceMirror(
  namespace: string
): Promise<{ memories: number; conversations: number }> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const memories = await client.query(`DELETE FROM memories WHERE namespace = $1`, [
      namespace,
    ]);
    const conversations = await client.query(
      `DELETE FROM conversations WHERE namespace = $1`,
      [namespace]
    );
    await client.query("COMMIT");
    return {
      memories: memories.rowCount ?? 0,
      conversations: conversations.rowCount ?? 0,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

/** Cheap liveness probe for /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await query(`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
