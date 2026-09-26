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
import { saveFacts, settleAfterResponse } from "@/lib/memory/save";
import { extractFacts } from "@/lib/memory/extract";
import { buildSystemPrompt } from "@/lib/memory/prompt";
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

  // 2. Generate the reply with memory context in the system prompt.
  const system = buildSystemPrompt({
    user,
    namespace,
    memories,
    memoryEnabled,
  });

  const result = streamText({
    model: geminiModel(),
    system,
    messages: await convertToModelMessages(body.messages),
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

        if (!memoryEnabled) return;

        // 3. After the reply: extract durable facts and anchor them to Walrus.
        try {
          const answer = await result.text;
          const facts = await extractFacts(promptText, answer);
          if (facts.length > 0) {
            const { saved, settle } = await saveFacts(namespace, facts);
            settleAfterResponse(settle);
            if (saved.length > 0) {
              writer.write({
                type: "data-savedFacts",
                id: crypto.randomUUID(),
                data: { facts, network: memwalNetwork() },
              });
            }
          }
        } catch (e) {
          console.error("[mnemo] save failed:", e);
        }
      },
    }),
  });
}
