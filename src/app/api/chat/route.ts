import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";
import { geminiModel } from "@/lib/llm";
import { SESSION_COOKIE, readSessionToken } from "@/lib/sui-auth";
import { getRequestCookie } from "@/lib/http";
import { addressNamespace, shortAddress } from "@/lib/sui";
import { memoryConfigured, memwalNetwork } from "@/lib/memory/client";
import { recallForNamespace } from "@/lib/memory/recall";
import {
  saveFacts,
  settleAfterResponse,
} from "@/lib/memory/save";
import { saveConversationSnapshot } from "@/lib/memory/store";
import { extractFacts } from "@/lib/memory/extract";
import {
  buildSystemPrompt,
  formatMemoryContext,
  withMemoryMessage,
} from "@/lib/memory/prompt";
import type {
  ChatRequestBody,
  ChatUIMessage,
  RecalledMemoryMeta,
} from "@/lib/chat-types";

export const runtime = "nodejs";
export const maxDuration = 60;

function lastUserText(messages: ChatUIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

/** First user line — stable across turns, so it doubles as the chat title. */
function conversationTitle(messages: ChatUIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
      .trim();
    if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return "New chat";
}

// Keep snapshots bounded so one marathon thread cannot bloat a JSONB row.
const MAX_SNAPSHOT_MESSAGES = 200;

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Wallet session: the namespace is derived from the verified Sui address in
  // the httpOnly session cookie — never from the request body.
  const address = readSessionToken(getRequestCookie(req, SESSION_COOKIE));
  if (!address) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "No messages" }, { status: 400 });
  }
  if (body.conversationId !== undefined && typeof body.conversationId !== "string") {
    return Response.json({ error: "Invalid conversationId" }, { status: 400 });
  }
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const user = shortAddress(address);
  const namespace = addressNamespace(address);
  const memoryEnabled = !body.forgetMode && memoryConfigured();
  const promptText = lastUserText(body.messages);
  if (!promptText) {
    return Response.json({ error: "Empty message" }, { status: 400 });
  }

  // 1. Recall relevant context from this user's Walrus Memory namespace.
  const recalled = memoryEnabled
    ? await recallForNamespace(namespace, promptText)
    : { memories: [], attempts: 0 };
  if (recalled.error) {
    console.error("[mnemo] recall failed:", recalled.error);
  }
  const memories = recalled.memories;
  const memoryMeta: RecalledMemoryMeta[] = memories.map((m) => ({
    text: m.text,
    distance: m.distance,
    createdAt: m.createdAt,
  }));

  // 2. Generate the reply. The system prompt carries only the fixed trust
  // policy; the recalled bytes ride in their own user message behind a nonce
  // boundary, so nothing memory-controlled ever holds system priority.
  const system = buildSystemPrompt({
    user,
    namespace,
    memories,
    memoryEnabled,
  });
  const converted = await convertToModelMessages(body.messages);
  const messages =
    memoryEnabled && memories.length > 0
      ? withMemoryMessage(converted, formatMemoryContext(memories))
      : converted;

  const result = streamText({
    model: geminiModel(),
    system,
    messages,
    maxRetries: 4,
  });

  const metadata = {
    memories: memoryMeta,
    recallAttempts: recalled.attempts,
    namespace,
    memoryEnabled,
  };

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatUIMessage>({
      originalMessages: body.messages,
      onError: (error) => {
        console.error("[mnemo] stream error:", error);
        return "Something went wrong generating a reply.";
      },
      async execute({ writer }) {
        // Send which memories shaped this reply as soon as streaming starts.
        writer.merge(
          result.toUIMessageStream({
            messageMetadata: ({ part }) =>
              part.type === "start" || part.type === "finish"
                ? metadata
                : undefined,
          })
        );

        const answer = await result.text;

        // 3. After the reply: extract durable facts and anchor them to Walrus.
        let savedFactsPart: ChatUIMessage["parts"][number] | undefined;
        if (memoryEnabled) {
          try {
            const facts = await extractFacts(promptText, answer);
            if (facts.length > 0) {
              const { saved, settle } = await saveFacts(namespace, facts);
              settleAfterResponse(settle);
              if (saved.length > 0) {
                const data = { facts, network: memwalNetwork() };
                const id = crypto.randomUUID();
                writer.write({ type: "data-savedFacts", id, data });
                savedFactsPart = { type: "data-savedFacts", id, data };
              }
            }
          } catch (e) {
            console.error("[mnemo] save failed:", e);
          }
        }

        // 4. Persist the whole thread. History is a UI feature, not the bot's
        // memory, so it saves even in forget mode (only step 3 is gated).
        try {
          const assistantMessage: ChatUIMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            parts: [
              { type: "text", text: answer },
              ...(savedFactsPart ? [savedFactsPart] : []),
            ],
            metadata,
          };
          const savedId = await saveConversationSnapshot({
            id: body.conversationId ?? null,
            namespace,
            title: conversationTitle(body.messages),
            messages: [...body.messages, assistantMessage].slice(
              -MAX_SNAPSHOT_MESSAGES
            ),
          });
          // Only speak up when the row is new (or the client's id went stale),
          // so the browser can adopt the id it should send next turn.
          if (savedId !== body.conversationId) {
            writer.write({
              type: "data-conversationId",
              id: crypto.randomUUID(),
              data: { id: savedId },
            });
          }
        } catch (e) {
          console.error("[mnemo] conversation save failed:", e);
        }
      },
    }),
  });
}
