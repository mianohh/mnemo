import { getMemWal, memoryConfigured, memwalNetwork } from "@/lib/memory/client";
import { pingDatabase } from "@/lib/memory/store";

export const runtime = "nodejs";

export async function GET() {
  const memwalConfigured = memoryConfigured();
  let relayer: { status?: string; version?: string; error?: string } = {};

  if (memwalConfigured) {
    try {
      const health = await getMemWal().health();
      relayer = { status: health.status, version: health.version };
    } catch (e) {
      relayer = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return Response.json({
    ok: true,
    app: "mnemo-ai",
    llm: process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest",
    memwalConfigured,
    network: memwalNetwork(),
    relayer,
    database: Boolean(process.env.DATABASE_URL) ? await pingDatabase() : false,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    time: new Date().toISOString(),
  });
}
