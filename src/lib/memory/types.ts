export const CATEGORIES = [
  "project",
  "constraint",
  "decision",
  "preference",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  project: "Projects",
  constraint: "Constraints",
  decision: "Decisions",
  preference: "Preferences",
};

export const CATEGORY_PREFIX: Record<Category, string> = {
  project: "Project",
  constraint: "Constraint",
  decision: "Decision",
  preference: "Preference",
};

export type MemoryStatus = "pending" | "done" | "failed";

export interface MirrorMemory {
  id: string;
  namespace: string;
  category: Category;
  text: string;
  blobId: string | null;
  jobId: string | null;
  status: MemoryStatus;
  createdAt: string;
  /** Sui object id of the Walrus Blob holding this memory (null until resolved). */
  blobObjectId: string | null;
  /** Walrus epoch the blob was registered in. */
  blobStartEpoch: number | null;
  /** Walrus epoch the blob disappears at — the blob is gone from the start of it. */
  blobExpiryEpoch: number | null;
}

export interface RecalledMemory {
  blobId: string;
  text: string;
  distance: number;
  createdAt?: string;
}

export interface SavedFact {
  category: Category;
  text: string;
}
