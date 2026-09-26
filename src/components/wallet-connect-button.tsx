"use client";

import { useState } from "react";
import { useConnectWallet, useWallets } from "@mysten/dapp-kit";
import { LoaderCircleIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const connectButtonClasses =
  "bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-600/40";

export function WalletConnectButton({
  className,
  size = "lg",
  label = "Connect wallet",
}: {
  className?: string;
  size?: "default" | "lg";
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size={size}
        className={cn(connectButtonClasses, className)}
        onClick={() => setOpen(true)}
      >
        <WalletIcon className="size-4" />
        {label}
      </Button>
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wallets = useWallets();
  const { mutateAsync: connect, isPending, error, reset } = useConnectWallet();
  const [connecting, setConnecting] = useState<string | null>(null);

  const close = () => {
    reset();
    setConnecting(null);
    onOpenChange(false);
  };

  const handleConnect = async (wallet: (typeof wallets)[number]) => {
    setConnecting(wallet.name);
    try {
      await connect({ wallet });
      close();
    } catch {
      setConnecting(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
          <DialogDescription>Choose a wallet to continue.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          {wallets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              No Sui wallet detected. Install Sui Wallet, Nightly or Phantom
              (Sui), then reload this page.
            </p>
          ) : (
            wallets.map((wallet) => (
              <button
                key={wallet.name}
                type="button"
                disabled={isPending}
                onClick={() => void handleConnect(wallet)}
                className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wallet.icon}
                  alt=""
                  className="size-8 shrink-0 rounded-md"
                />
                <span className="flex-1 font-medium">{wallet.name}</span>
                {connecting === wallet.name && (
                  <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                )}
              </button>
            ))
          )}
          {error && (
            <p className="text-xs text-destructive">
              {error.message || "Connection failed"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
