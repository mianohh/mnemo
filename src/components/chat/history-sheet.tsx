"use client";

import * as React from "react";
import { toast } from "sonner";
import { HistoryIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DeleteDataDialog } from "@/components/chat/delete-data-dialog";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConversationDetail, ConversationSummary } from "@/lib/chat-types";

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}

type ConfirmTarget = { kind: "one"; id: string } | { kind: "all" } | null;

/**
 * The History tab: a trigger button plus a slide-in drawer listing every
 * saved conversation (title, age, size) with per-item delete, delete-all,
 * and the Danger Zone that wipes the whole Postgres mirror.
 */
export function HistorySheet({
  activeId,
  onSelect,
  onNewChat,
  onDeleted,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /** Ids removed by this drawer; parent resets its chat if activeId is among them. */
  onDeleted: (ids: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [conversations, setConversations] = React.useState<ConversationSummary[] | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmTarget>(null);
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(body.conversations);
    } catch {
      setConversations([]);
      toast.error("Couldn't load your chats");
    }
  }, []);

  const openDrawer = () => {
    setOpen(true);
    void load();
  };

  const runDelete = async (target: ConfirmTarget) => {
    if (!target || busy) return;
    setBusy(true);
    try {
      const before = conversations ?? [];
      const url =
        target.kind === "one"
          ? `/api/conversations?id=${encodeURIComponent(target.id)}`
          : "/api/conversations";
      const res = await apiFetch(url, { method: "DELETE" });
      const body = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok || typeof body.deleted !== "number") {
        throw new Error(body.error ?? "Delete failed");
      }
      const removedIds =
        target.kind === "one" ? [target.id] : before.map((c) => c.id);
      toast.success(
        target.kind === "one"
          ? "Conversation deleted"
          : `${body.deleted} conversation(s) deleted`
      );
      setConfirm(null);
      onDeleted(removedIds);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const count = conversations?.length ?? 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openDrawer}
        aria-label="Previous chats"
        className="h-7 shrink-0 gap-1.5 px-2 text-xs"
      >
        <HistoryIcon className="size-3.5" />
        <span className="hidden sm:inline">History</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Previous chats</SheetTitle>
            <SheetDescription>
              Stored in your namespace — click one to pick up where you left off.
            </SheetDescription>
          </SheetHeader>

          <Button
            variant="outline"
            className="justify-start gap-2 border-dashed"
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
          >
            <PlusIcon className="size-4" /> New chat
          </Button>

          <div className="scroll-area -mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1">
            {conversations === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-muted/60"
                />
              ))
            ) : count === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                No conversations yet — your chats will show up here after your
                first message.
              </p>
            ) : (
              conversations.map((c) => (
                <div key={c.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(c.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center rounded-xl border border-transparent bg-card/60 px-3 py-2.5 pr-10 text-left transition-colors hover:border-border hover:bg-muted/60",
                      activeId === c.id &&
                        "border-mint bg-mint/40 dark:bg-mint/15"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {timeAgo(c.updatedAt)} · {c.messageCount} message
                        {c.messageCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={() => setConfirm({ kind: "one", id: c.id })}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg p-2 text-muted-foreground opacity-60 transition-colors hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
            {count > 0 && (
              <button
                type="button"
                onClick={() => setConfirm({ kind: "all" })}
                className="text-left text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
              >
                Delete all chats ({count})
              </button>
            )}
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive">
                Danger zone
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Erase every memory and conversation in your database mirror.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setWipeOpen(true)}
              >
                Delete all my data
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm deleting one / all conversations */}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "all"
                ? "Delete all conversations?"
                : "Delete this conversation?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "all"
                ? `This removes all ${count} saved conversations from the database. Memories are kept.`
                : "This removes the conversation from the database. Memories are kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void runDelete(confirm)}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full mirror wipe */}
      <DeleteDataDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        onWiped={() => {
          onDeleted((conversations ?? []).map((c) => c.id));
          setConversations([]);
          // Wipe = clean slate, even if the open chat was never saved.
          onNewChat();
          setOpen(false);
        }}
      />
    </>
  );
}

/** Load one conversation's full thread for the chat panel. */
export async function fetchConversation(
  id: string
): Promise<ConversationDetail> {
  const res = await apiFetch(`/api/conversations?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Conversation not found");
  return (await res.json()) as ConversationDetail;
}
