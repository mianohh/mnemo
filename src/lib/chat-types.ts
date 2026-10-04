import type { UIMessage } from "ai";
import type { Category } from "./memory/types";

export interface RecalledMemoryMeta {
  text: string;
  distance: number;
  createdAt?: string;
}

interface ChatMessageMetadata {
  /** Memories injected into this turn's prompt, in injection order. */
  memories?: RecalledMemoryMeta[];
  recallAttempts?: number;
  namespace?: string;
  memoryEnabled?: boolean;
}

interface SavedFactsData {
  facts: { category: Category; text: string }[];
  network: "mainnet" | "testnet";
}

type ChatDataParts = {
  savedFacts: SavedFactsData;
  /** Emitted once per stream so the client learns which row we saved to. */
  conversationId: { id: string };
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

export interface ChatRequestBody {
  messages: ChatUIMessage[];
  forgetMode?: boolean;
  /** Omit to start a fresh conversation; the stream echoes the id back. */
  conversationId?: string;
}

/** One conversation in the History drawer (no message bodies). */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatUIMessage[];
}

export interface WipeResult {
  memories: number;
  conversations: number;
}
