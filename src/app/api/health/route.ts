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
    zkLogin: {
      googleConfigured: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      saltConfigured: Boolean(
        process.env.ZKLOGIN_SALT_SECRET ?? process.env.SESSION_SECRET
      ),
    },
    time: new Date().toISOString(),
  });
}
