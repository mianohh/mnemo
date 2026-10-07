"use client";

import * as React from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
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
import { apiFetch } from "@/lib/api";
import type { WipeResult } from "@/lib/chat-types";

/**
 * The "delete the database" confirmation: asks the user literally *are you
 * sure you want to delete*, and only unlocks the red button once they type
 * DELETE. Server re-checks the same phrase — the dialog is not the only guard.
 */
export function DeleteDataDialog({
  open,
  onOpenChange,
  onWiped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWiped: (result: WipeResult) => void;
}) {
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirmText("");
      setBusy(false);
    }
    onOpenChange(next);
  };

  const wipe = async () => {
    if (confirmText !== "DELETE" || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/memory", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const body = (await res.json()) as WipeResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Delete failed");
      toast.success("Your data was deleted", {
        description: `${body.conversations} conversation(s) and ${body.memories} memor${
          body.memories === 1 ? "y" : "ies"
        } removed from the mirror.`,
      });
      onWiped(body);
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlertIcon className="size-4 shrink-0" />
            Are you sure you want to delete?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>every memory and every chat</strong>{" "}
            stored for your account in Mnemo&apos;s Postgres mirror. It cannot
            be undone. Walrus blobs on chain are not affected — they simply stop
            being mirrored here.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
          <span>
            Type <span className="font-mono font-semibold">DELETE</span> to
            confirm
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="DELETE"
            className="h-9 rounded-lg border-2 border-ink/80 bg-background px-2.5 font-mono text-sm tracking-wider outline-none focus:border-destructive dark:border-border"
          />
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={confirmText !== "DELETE" || busy}
            onClick={() => void wipe()}
          >
            {busy ? "Deleting…" : "Delete everything"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
