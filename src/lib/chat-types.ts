import type { UIMessage } from "ai";
import type { Category } from "./memory/types";

export interface RecalledMemoryMeta {
  text: string;
  distance: number;
  createdAt?: string;
}

export interface ChatMessageMetadata {
  /** Memories injected into this turn's prompt, in injection order. */
  memories?: RecalledMemoryMeta[];
  recallAttempts?: number;
  namespace?: string;
  memoryEnabled?: boolean;
}

export interface SavedFactsData {
  facts: { category: Category; text: string }[];
  network: "mainnet" | "testnet";
}

export type ChatDataParts = {
  savedFacts: SavedFactsData;
};

export type ChatUIMessage = UIMessage<ChatMessageMetadata, ChatDataParts>;

export interface ChatRequestBody {
  messages: ChatUIMessage[];
  forgetMode?: boolean;
}
