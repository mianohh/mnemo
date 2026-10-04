import { SESSION_COOKIE, readSessionToken } from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { addressNamespace } from "@/lib/sui";
import {
  deleteAllConversations,
  deleteConversation,
  getConversation,
  listConversations,
} from "@/lib/memory/store";
import type { ConversationDetail, ConversationSummary } from "@/lib/chat-types";

export const runtime = "nodejs";

function requireNamespace(req: Request): string | null {
  const address = readSessionToken(getRequestCookie(req, SESSION_COOKIE));
  return address ? addressNamespace(address) : null;
}

/** List (default) or fetch one conversation: `GET /api/conversations?id=…`. */
export async function GET(req: Request) {
  const namespace = requireNamespace(req);
  if (!namespace) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id) {
      const conversation: ConversationDetail | null = await getConversation(
        namespace,
        id
      );
      if (!conversation) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json(conversation);
    }
    const conversations: ConversationSummary[] = await listConversations(namespace);
    return Response.json({ conversations });
  } catch {
    return Response.json({ error: "Database unavailable" }, { status: 503 });
  }
}

/**
 * Delete one (`?id=…`) or every conversation for this namespace.
 * The namespace always comes from the session cookie, never the query.
 */
export async function DELETE(req: Request) {
  const namespace = requireNamespace(req);
  if (!namespace) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  try {
    const deleted = id
      ? await deleteConversation(namespace, id)
      : await deleteAllConversations(namespace);
    return Response.json({ deleted });
  } catch {
    return Response.json({ error: "Database unavailable" }, { status: 503 });
  }
}
