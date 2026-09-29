"use client";

import { BrainIcon, CheckIcon, DatabaseIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { RecalledMemoryMeta } from "@/lib/chat-types";

export function MemoryIndicator({
  memories,
  namespace,
  attempts,
}: {
  memories: RecalledMemoryMeta[];
  namespace?: string;
  attempts?: number;
}) {
  if (memories.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-full border border-mint-strong/50 bg-mint/60 px-2.5 py-1 text-xs font-medium text-mint-ink shadow-xs transition-colors hover:bg-mint focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:bg-mint/15">
        <BrainIcon className="size-3.5" />
        [{memories.length}] memories applied
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-1.5 p-3">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-1.5 text-sm">
            <DatabaseIcon className="size-3.5 text-mint-ink" />
            Recalled from Walrus Memory
          </PopoverTitle>
          <p className="text-xs text-muted-foreground">
            {namespace ? `namespace ${namespace}` : ""}
            {attempts && attempts > 1
              ? ` · resolved after ${attempts} attempts`
              : ""}
          </p>
        </PopoverHeader>
        <ul className="mt-1 flex flex-col gap-1.5">
          {memories.map((m, i) => {
            const relevance = Math.max(0, Math.min(1, 1 - m.distance));
            return (
              <li
                key={`${m.text}-${i}`}
                className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-relaxed"
              >
                <CheckIcon className="mt-0.5 size-3 shrink-0 text-mint-ink" />
                <span className="flex-1">{m.text}</span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {relevance.toFixed(2)}
                  </span>
                  <span
                    className="h-1 w-10 overflow-hidden rounded-full bg-border"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-mint-strong"
                      style={{ width: `${Math.round(relevance * 100)}%` }}
                    />
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          Decrypted per-request with your session key · stored on Walrus
          mainnet
        </p>
      </PopoverContent>
    </Popover>
  );
}
