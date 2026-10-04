"use client";

import * as React from "react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLineIcon,
  ArrowUpIcon,
  BrainIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MemoryIndicator } from "@/components/chat/memory-indicator";
import { CodeBlock } from "@/components/chat/code-block";
import { HistorySheet, fetchConversation } from "@/components/chat/history-sheet";
import { useAuth } from "@/components/auth-context";
import { SignInGate } from "@/components/sign-in-gate";
import { apiFetch, apiUrl } from "@/lib/api";
import { addressNamespace } from "@/lib/sui";
import type { ChatUIMessage } from "@/lib/chat-types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What do you remember about me?",
  "I'm starting a new project — infra budget is capped at $50/mo",
  "Which memories are most relevant to my current project?",
];

/** How close to the bottom (px) still counts as "pinned" for auto-follow. */
const PIN_THRESHOLD = 80;

function isSavedFactsPart(
  part: ChatUIMessage["parts"][number]
): part is Extract<
  ChatUIMessage["parts"][number],
  { type: "data-savedFacts" }
> {
  return part.type === "data-savedFacts";
}

function isConversationIdPart(
  part: ChatUIMessage["parts"][number]
): part is Extract<
  ChatUIMessage["parts"][number],
  { type: "data-conversationId" }
> {
  return part.type === "data-conversationId";
}

/**
 * One chat row. Memoized so a streaming reply re-renders only itself —
 * re-running the whole list on every token is what made generation jitter.
 */
const MessageRow = React.memo(function MessageRow({
  message,
  streaming,
}: {
  message: ChatUIMessage;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
  const meta = message.metadata;
  const savedPart = message.parts.find(isSavedFactsPart);

  if (!isUser && !text && !savedPart && streaming) {
    return (
      <div className="flex items-start gap-3">
        <Avatar />
        <div className="pt-1.5 text-sm text-muted-foreground">
          Mnemo is thinking…
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-mint px-3.5 py-2 text-sm text-mint-on">
          <div className="whitespace-pre-wrap break-words">{text}</div>
        </div>
      </div>
    );
  }

  const memories = meta?.memories ?? [];
  return (
    <div className="flex items-start gap-3">
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: (props) => <CodeBlock {...props} />,
            }}
          >
            {text || (streaming ? "" : "…")}
          </ReactMarkdown>
        </div>
        {savedPart && (
          <div className="mint-chip mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium">
            <BrainIcon className="size-3" />
            {savedPart.data.facts.length} new{" "}
            {savedPart.data.facts.length === 1 ? "fact" : "facts"} saved to{" "}
            {savedPart.data.network}
          </div>
        )}
      </div>
    </div>
  );
});

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

  // Chat history: which server-side conversation this thread writes to.
  const [conversationId, setConversationId] = React.useState<string | null>(
    null
  );
  const seenConversationIds = React.useRef<Set<string>>(new Set());

  // Scroll pinning: follow the stream only while the user is already at the
  // bottom; otherwise leave their position alone and offer a jump button.
  const pinnedRef = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);

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

  const {
    messages,
    sendMessage,
    status,
    error,
    regenerate,
    clearError,
    setMessages,
  } = useChat<ChatUIMessage>({
    transport,
    onError: (err) => {
      toast.error(err.message || "Request failed");
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const streaming = status === "streaming";

  // The model is configurable (GEMINI_MODEL), so read it from the API instead
  // of hardcoding a name that silently goes stale on the next deploy.
  const [model, setModel] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    apiFetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { llm?: unknown }) => {
        if (!cancelled && typeof body.llm === "string") setModel(body.llm);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isSavedFactsPart(part)) continue;
        const key =
          part.id ?? `${message.id}:${part.data.facts[0]?.text ?? ""}`;
        if (seenToasts.current.has(key)) continue;
        seenToasts.current.add(key);
        toast(
          part.data.network === "testnet"
            ? "New context anchored to Testnet"
            : "New context anchored to Mainnet",
          {
            description: part.data.facts
              .map((f) => `${f.category}: ${f.text}`)
              .join(" · "),
          }
        );
      }
    }
  }, [messages]);

  // Adopt the id of the row the server saved to (echoed once per stream when
  // it is new or our id went stale), so the next turn appends to that thread.
  React.useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (!isConversationIdPart(part)) continue;
        const id = part.data.id;
        if (seenConversationIds.current.has(id)) continue;
        seenConversationIds.current.add(id);
        setConversationId(id);
      }
    }
  }, [messages]);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    pinnedRef.current = near;
    setShowJump(!near);
  }, []);

  // Follow the stream only while pinned. Instant, not smooth: queueing a
  // smooth animation per token is exactly the "jumping" users saw.
  React.useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const jumpToBottom = React.useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Scroll shortcut: End or Ctrl/⌘+↓ jumps back to the live stream.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      const jump =
        e.key === "End" || (e.key === "ArrowDown" && (e.ctrlKey || e.metaKey));
      if (!jump) return;
      e.preventDefault();
      jumpToBottom("smooth");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpToBottom]);

  const setUrlConversation = React.useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, []);

  const newChat = React.useCallback(() => {
    setMessages([]);
    setConversationId(null);
    clearError();
    setInput("");
    pinnedRef.current = true;
    setShowJump(false);
    setUrlConversation(null);
  }, [setMessages, clearError, setUrlConversation]);

  const openConversation = React.useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      try {
        const detail = await fetchConversation(id);
        // Historical saved-facts chips must not re-toast as if they were new.
        for (const message of detail.messages) {
          if (message.role !== "assistant") continue;
          for (const part of message.parts) {
            if (!isSavedFactsPart(part)) continue;
            seenToasts.current.add(
              part.id ?? `${message.id}:${part.data.facts[0]?.text ?? ""}`
            );
          }
        }
        setMessages(detail.messages);
        setConversationId(detail.id);
        seenConversationIds.current.add(detail.id);
        clearError();
        pinnedRef.current = true;
        setShowJump(false);
        setUrlConversation(detail.id);
      } catch {
        setUrlConversation(null);
        if (!opts?.silent) toast.error("Couldn't open that conversation");
      }
    },
    [setMessages, clearError, setUrlConversation]
  );

  // Restore the conversation behind `?c=…` after a refresh. This reads an
  // external system (the URL) exactly once on mount, so it is a genuine
  // effect; the load itself resolves before any state is touched.
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL restore on mount
    void openConversation(id, { silent: true });
  }, [openConversation]);

  const handleDeleted = React.useCallback(
    (ids: string[]) => {
      if (conversationId && ids.includes(conversationId)) {
        setMessages([]);
        setConversationId(null);
        setInput("");
        clearError();
        setUrlConversation(null);
      }
    },
    [conversationId, setMessages, clearError, setUrlConversation]
  );

  const submit = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      pinnedRef.current = true;
      setShowJump(false);
      void sendMessage(
        { text: trimmed },
        {
          body: {
            forgetMode,
            conversationId: conversationId ?? undefined,
          },
        }
      );
      setInput("");
    },
    [busy, sendMessage, forgetMode, conversationId]
  );

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col">
      {/* Context bar */}
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-background/80 px-3 py-2.5 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={newChat}
            aria-label="New chat"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
          <HistorySheet
            activeId={conversationId}
            onSelect={(id) => void openConversation(id)}
            onNewChat={newChat}
            onDeleted={handleDeleted}
          />
          <span className="truncate rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px]">
            {namespace}
          </span>
          {model && (
            <span className="hidden whitespace-nowrap rounded-full border border-border px-2 py-0.5 font-mono text-[11px] sm:inline">
              {model}
            </span>
          )}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs">
          <span
            className={cn(
              "pixel-font whitespace-nowrap text-[10px] tracking-wider",
              forgetMode ? "text-amber-600 dark:text-amber-400" : "text-mint-ink"
            )}
          >
            {forgetMode ? "MEMORY OFF" : "MEMORY ON"}
          </span>
          <Switch
            checked={!forgetMode}
            onCheckedChange={(v) => setForgetMode(!v)}
            aria-label="Toggle Walrus Memory"
          />
        </label>
      </div>
      {forgetMode && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-700 dark:text-amber-300">
          Forget mode: the bot has no memory of you — this is the “before”
          experience.
        </div>
      )}

      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="scroll-area pixel-grid h-full overflow-y-auto"
        >
          <div className="flex flex-col gap-6 px-4 py-6">
            {messages.length === 0 && (
              <div className="mt-6 flex flex-col items-center gap-6 text-center">
                <span className="flex size-24 items-center justify-center overflow-hidden rounded-3xl border-2 border-ink bg-mint p-2 shadow-[4px_4px_0_0_var(--ink)] dark:border-mint/40 dark:shadow-none">
                  <Image
                    src="/brand/walrus-mascot.png"
                    alt=""
                    width={96}
                    height={120}
                    className="h-20 w-auto"
                    priority
                  />
                </span>
                <div>
                  <p className="pixel-font text-[11px] uppercase tracking-[0.25em] text-mint-ink">
                    Walrus Memory connected
                  </p>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                    I remember you.
                  </h1>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
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
                      className="sticker-sm flex items-center gap-2 rounded-xl bg-card px-3.5 py-3 text-left text-sm transition-colors hover:bg-mint/50"
                    >
                      <SparklesIcon className="size-3.5 shrink-0 text-mint-ink" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                streaming={streaming}
              />
            ))}

            {streaming && messages.length > 0 && (
              <div className="flex items-center gap-3">
                <Avatar />
                <div className="flex gap-1.5">
                  <Dot />
                  <Dot delay={150} />
                  <Dot delay={300} />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <span className="truncate">{error.message}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => {
                    clearError();
                    void regenerate({
                      body: {
                        forgetMode,
                        conversationId: conversationId ?? undefined,
                      },
                    });
                  }}
                >
                  <RotateCcwIcon className="size-3.5" /> Retry
                </Button>
              </div>
            )}
          </div>
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => jumpToBottom("smooth")}
            className="sticker-sm absolute right-4 bottom-3 z-10 flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-mint/60"
          >
            <ArrowDownToLineIcon className="size-3.5" />
            Jump to bottom
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border/70 bg-background/95 px-4 py-3 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2 rounded-2xl border-2 border-ink/90 bg-card p-2 shadow-[3px_3px_0_0_var(--ink)] transition-colors focus-within:border-mint-strong dark:border-mint/30 dark:shadow-none dark:focus-within:border-mint-strong"
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
            className="size-9 shrink-0 rounded-xl bg-mint text-mint-on hover:bg-mint-strong focus-visible:ring-mint-strong/50 sm:size-8"
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <ArrowUpIcon className="size-4" />
          </Button>
        </form>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Memories are extracted after each turn and anchored to Walrus —{" "}
          click “memories applied” to see exactly what was recalled.
        </p>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink/80 bg-mint dark:border-mint/40">
      <Image
        src="/brand/walrus-mascot.png"
        alt=""
        width={32}
        height={40}
        className="h-6 w-auto -translate-y-px"
      />
    </span>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="dot-bounce size-1.5 rounded-full bg-mint-strong"
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
