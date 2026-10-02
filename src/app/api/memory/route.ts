import {
  SESSION_COOKIE,
  createMcpToken,
  readSessionToken,
} from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { addressNamespace } from "@/lib/sui";
import { getMemWal, memoryConfigured } from "@/lib/memory/client";
import {
  countByCategory,
  countMemories,
  expirySnapshot,
  listExpiries,
  listMemories,
} from "@/lib/memory/store";
import {
  chainExpiryContext,
  maybeSyncAnchors,
  summariseExpiry,
  type ExpirySummary,
} from "@/lib/memory/anchor";
import { type Category, type MirrorMemory } from "@/lib/memory/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const address = readSessionToken(getRequestCookie(req, SESSION_COOKIE));
  if (!address) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const namespace = addressNamespace(address);

  // Refresh the on-chain anchor (object id + end epoch) for any blob the
  // mirror has not resolved yet. Best effort: a Sui hiccup must not take the
  // dashboard down, and it is a no-op when everything is already anchored.
  let sync: { linked?: number; error?: string } = {};
  try {
    const result = await maybeSyncAnchors();
    if (result) sync = { linked: result.linked, error: result.error };
  } catch (e) {
    sync = { error: e instanceof Error ? e.message : String(e) };
  }

  let memories: MirrorMemory[];
  let counts: Record<Category, number>;
  let mirrorCount: number;
  let expiry: ExpirySummary | null = null;
  try {
    memories = await listMemories(namespace);
    counts = await countByCategory(namespace);
    mirrorCount = await countMemories(namespace);
    // Chain first: the dashboard's epoch/expiry line should reflect the blobs
    // we own even while the mirror's own rows are still unlinked.
    expiry = summariseExpiry(await expirySnapshot(), await listExpiries(), {
      chain: await chainExpiryContext(),
    });
  } catch {
    return Response.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Cross-check against the relayer's own index (metadata only, no decrypt).
  const chain: {
    count?: number;
    storageBytes?: number;
    error?: string;
  } = {};
  if (memoryConfigured()) {
    try {
      const page = await getMemWal().listNamespaces({ limit: 500 });
      const ns = page.namespaces.find((n) => n.name === namespace);
      if (ns) {
        chain.count = ns.memory_count;
        chain.storageBytes = ns.storage_used;
      } else {
        chain.count = 0;
      }
    } catch (e) {
      chain.error = e instanceof Error ? e.message : String(e);
    }
  }

  const grouped: Record<Category, typeof memories> = {
    project: [],
    constraint: [],
    decision: [],
    preference: [],
  };
  for (const m of memories) grouped[m.category].push(m);

  // MCP connection details for this owner only (endpoint + bearer token).
  const origin = `${req.headers.get("x-forwarded-proto") ?? "http"}://${
    req.headers.get("host") ?? "localhost:3000"
  }`;

  return Response.json({
    address,
    namespace,
    mirrorCount,
    counts,
    chain,
    expiry,
    sync,
    mcp: { url: `${origin}/api/mcp`, token: createMcpToken(address) },
    grouped,
  });
}
