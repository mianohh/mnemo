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
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

export interface ChatRequestBody {
  messages: ChatUIMessage[];
  forgetMode?: boolean;
}
