"use client";

import * as React from "react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpIcon,
  BrainCircuitIcon,
  BrainIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MemoryIndicator } from "@/components/chat/memory-indicator";
import { useAuth } from "@/components/auth-context";
import { SignInGate } from "@/components/sign-in-gate";
import { apiUrl } from "@/lib/api";
import { addressNamespace } from "@/lib/sui";
import type { ChatUIMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What do you remember about me?",
  "I'm starting a new project — infra budget is capped at $50/mo",
  "Remind me why we chose Postgres over MongoDB",
];

function isSavedFactsPart(
  part: ChatUIMessage["parts"][number]
): part is Extract<
  ChatUIMessage["parts"][number],
  { type: "data-savedFacts" }
> {
  return part.type === "data-savedFacts";
}

function ChatPanel({
  address,
  forgetMode,
  setForgetMode,
}: {
  address: string;
  forgetMode: boolean;
  setForgetMode: (v: boolean) => void;
}) {
  const namespace = addressNamespace(address);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const seenToasts = React.useRef<Set<string>>(new Set());

  // `address` is fixed for the lifetime of this panel (parent keys on it);
  // forgetMode rides on each request body so a toggle takes effect immediately.
  // The server derives the namespace from the session cookie, not the body.
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: apiUrl("/api/chat"),
        credentials: "include",
      }),
    []
  );

  const { messages, sendMessage, status, error, regenerate, clearError } =
    useChat<ChatUIMessage>({
      transport,
      onError: (err) => {
        toast.error(err.message || "Request failed");
      },
    });

  const busy = status === "submitted" || status === "streaming";

  React.useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isSavedFactsPart(part)) continue;
        const key =
          part.id ?? `${message.id}:${part.data.facts[0]?.text ?? ""}`;
        if (seenToasts.current.has(key)) continue;
        seenToasts.current.add(key);
        toast(part.data.network === "testnet"
          ? "New context anchored to Testnet"
          : "New context anchored to Mainnet", {
          description: part.data.facts
            .map((f) => `${f.category}: ${f.text}`)
            .join(" · "),
        });
      }
    }
  }, [messages]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  const submit = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      void sendMessage(
        { text: trimmed },
        { body: { forgetMode } }
      );
      setInput("");
    },
    [busy, sendMessage, forgetMode]
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col">
      {/* Context bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-mono">{namespace}</span>
          <span className="hidden rounded-full border border-border px-2 py-0.5 sm:inline">
            gemini-flash-lite-latest
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <span className={cn(forgetMode ? "text-amber-600" : "text-emerald-600")}>
            {forgetMode ? "Memory OFF" : "Memory ON"}
          </span>
          <Switch
            checked={!forgetMode}
            onCheckedChange={(v) => setForgetMode(!v)}
            aria-label="Toggle Walrus Memory"
          />
        </label>
      </div>
      {forgetMode && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800">
          Forget mode: the bot has no memory of you — this is the “before”
          experience.
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-4 py-6">
          {messages.length === 0 && (
            <div className="mt-8 flex flex-col items-center gap-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                <BrainCircuitIcon className="size-6" />
              </span>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">
                  I remember you.
                </h1>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Mnemo stores what matters about you on Walrus Memory — your
                  projects, constraints, decisions, and preferences — and
                  recalls it in future sessions.
                </p>
              </div>
              <div className="flex w-full max-w-lg flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm shadow-xs transition-colors hover:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                  >
                    <SparklesIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            const isUser = message.role === "user";
            const text = message.parts
              .map((p) => (p.type === "text" ? p.text : ""))
              .join("");
            const meta = message.metadata;
            const savedPart = message.parts.find(isSavedFactsPart);

            if (!isUser && !text && !savedPart && status === "streaming") {
              return (
                <div key={message.id} className="flex items-start gap-3">
                  <Avatar />
                  <div className="text-sm text-muted-foreground">
                    Mnemo is thinking…
                  </div>
                </div>
              );
            }

            if (isUser) {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
                    <div className="whitespace-pre-wrap break-words">{text}</div>
                  </div>
                </div>
              );
            }

            const memories = meta?.memories ?? [];
            return (
              <div key={message.id} className="flex items-start gap-3">
                <Avatar />
                <div className="min-w-0 flex-1">
                  {memories.length > 0 && meta?.memoryEnabled !== false && (
                    <div className="mb-2">
                      <MemoryIndicator
                        memories={memories}
                        namespace={meta?.namespace}
                        attempts={meta?.recallAttempts}
                      />
                    </div>
                  )}
                  <div className="markdown break-words text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {text || (busy ? "" : "…")}
                    </ReactMarkdown>
                  </div>
                  {savedPart && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <BrainIcon className="size-3" />
                      {savedPart.data.facts.length} new{" "}
                      {savedPart.data.facts.length === 1 ? "fact" : "facts"}{" "}
                      saved to {savedPart.data.network}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {status === "streaming" && messages.length > 0 && (
            <div className="flex items-center gap-3">
              <Avatar />
              <div className="flex gap-1">
                <Dot />
                <Dot delay={150} />
                <Dot delay={300} />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="truncate">{error.message}</span>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  clearError();
                  void regenerate({ body: { forgetMode } });
                }}
              >
                <RotateCcwIcon className="size-3.5" /> Retry
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-xs focus-within:border-emerald-500/50 focus-within:ring-2 focus-within:ring-emerald-600/40"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder={
              forgetMode
                ? "Ask anything (the bot won't remember this)…"
                : "Tell Mnemo something worth remembering…"
            }
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            className="size-8 shrink-0 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/40"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Memories are extracted after each turn and anchored to Walrus — {""}
          click “memories applied” to see exactly what was recalled.
        </p>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-600/30 bg-card">
      <BrainCircuitIcon className="size-4 text-emerald-700 dark:text-emerald-400" />
    </span>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="size-1.5 animate-bounce rounded-full bg-emerald-500"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

export function ChatClient() {
  const { session, sessionLoading, forgetMode, setForgetMode } = useAuth();

  if (sessionLoading) {
    return (
      <div className="mx-auto h-[calc(100dvh-3.5rem)] w-full max-w-3xl animate-pulse bg-muted/30" />
    );
  }
  if (!session) {
    return <SignInGate />;
  }
  return (
    <ChatPanel
      key={session.address}
      address={session.address}
      forgetMode={forgetMode}
      setForgetMode={setForgetMode}
    />
  );
}
