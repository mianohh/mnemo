import { Pool, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import type { Category, MemoryStatus, MirrorMemory } from "./types";

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
    globalStore.__mnemoSchema = getPool()
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
    `).then(() => undefined);
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

interface Row extends QueryResultRow {
  id: string;
  namespace: string;
  category: Category;
  text: string;
  blob_id: string | null;
  job_id: string | null;
  status: MemoryStatus;
  created_at: Date | string;
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

/** Cheap liveness probe for /api/health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await query(`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
