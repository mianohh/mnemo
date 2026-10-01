import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMemWal, memoryConfigured, memwalNetwork } from "./memory/client";
import { recallForNamespace } from "./memory/recall";
import { saveFacts, settleAfterResponse } from "./memory/save";
import {
  countByCategory,
  countMemories,
  listMemories,
  pendingCount,
} from "./memory/store";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_PREFIX } from "./memory/types";

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(payload: unknown): TextResult {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function fail(message: string): TextResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Mnemo's memory exposed as MCP tools, scoped to ONE namespace.
 *
 * The namespace always comes from the verified bearer token's Sui address —
 * tool arguments can never address another user's memories.
 */
export function createMcpServer(namespace: string): McpServer {
  const server = new McpServer({ name: "mnemo", version: "0.1.0" });

  server.registerTool(
    "mnemo_recall",
    {
      title: "Recall memories",
      description:
        "Semantic search across this user's durable memories stored on Walrus. " +
        "Use before answering anything about the user's projects, constraints, " +
        "decisions, or preferences. Returns matching facts with a relevance score " +
        "(0-1, higher is better).",
      inputSchema: {
        query: z.string().min(1).describe("What to look for, in natural language"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(6)
          .describe("Maximum number of memories to return"),
      },
    },
    async ({ query, limit }) => {
      try {
        const outcome = await recallForNamespace(namespace, query, limit);
        if (outcome.error && outcome.memories.length === 0) {
          return fail(`Recall failed after ${outcome.attempts} attempt(s): ${outcome.error}`);
        }
        return ok({
          query,
          attempts: outcome.attempts,
          count: outcome.memories.length,
          memories: outcome.memories.map((m) => ({
            text: m.text,
            relevance: Number((1 - m.distance).toFixed(3)),
            blobId: m.blobId,
            createdAt: m.createdAt ?? null,
          })),
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "mnemo_remember",
    {
      title: "Remember a fact",
      description:
        "Save a durable fact about the user to decentralized memory (Walrus). " +
        "Use for preferences, decisions, constraints, and project facts that " +
        "should survive into future sessions. WARNING: writes are permanent — " +
        "stored data cannot be deleted from Walrus. Never store secrets, " +
        "passwords, API keys, or private keys.",
      inputSchema: {
        text: z
          .string()
          .min(8)
          .max(400)
          .describe("The fact, third person and self-contained, e.g. 'Prefers pnpm'"),
        category: z
          .enum(CATEGORIES)
          .default("preference")
          .describe(
            "project = what they build; constraint = hard limits; " +
              "decision = a choice made; preference = how they like to work"
          ),
      },
    },
    async ({ text, category }) => {
      try {
        const fact = { category, text: text.trim() };
        const { saved, settle } = await saveFacts(namespace, [fact]);
        if (saved.length === 0) return fail("Memory is not configured on this deployment.");
        settleAfterResponse(settle);
        return ok({
          status: "queued",
          category,
          text: `${CATEGORY_PREFIX[category]}: ${fact.text}`,
          jobId: saved[0].jobId,
          note: "Stored to Walrus Memory; indexing finishes seconds after the write.",
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "mnemo_list_memories",
    {
      title: "List memories",
      description:
        "List this user's memories from the local mirror (newest first), " +
        "optionally filtered by category. Prefer mnemo_recall for lookups by meaning.",
      inputSchema: {
        category: z.enum(CATEGORIES).optional().describe("Filter to one category"),
        limit: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ category, limit }) => {
      try {
        const all = await listMemories(namespace);
        const rows = (category ? all.filter((m) => m.category === category) : all)
          .slice(0, limit)
          .map((m) => ({
            text: m.text,
            category: CATEGORY_LABELS[m.category],
            status: m.status,
            blobId: m.blobId,
            createdAt: m.createdAt,
          }));
        return ok({ count: rows.length, total: all.length, memories: rows });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    "mnemo_health",
    {
      title: "Memory health",
      description:
        "Connectivity and consistency check: Walrus Memory relayer status, " +
        "mirror row counts by category, and the pending-write backlog.",
      inputSchema: {},
    },
    async () => {
      try {
        const network = memwalNetwork();
        const counts = await countByCategory(namespace);
        const total = await countMemories(namespace);
        const pending = await pendingCount(namespace);
        let relayer: Record<string, unknown> = { configured: memoryConfigured() };
        if (memoryConfigured()) {
          try {
            const h = await getMemWal().health();
            relayer = { ...relayer, status: h.status, version: h.version };
          } catch (e) {
            relayer = { ...relayer, error: e instanceof Error ? e.message : String(e) };
          }
        }
        return ok({ namespace, network, relayer, mirror: { total, pending, counts } });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
  );

  return server;
}
