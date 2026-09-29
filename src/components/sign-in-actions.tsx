"use client";

import { MailIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-context";
import {
  WalletConnectButton,
  connectButtonClasses,
} from "@/components/wallet-connect-button";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { cn } from "@/lib/utils";

/**
 * The single sign-in block used by the landing hero and the compact gate:
 * email (zkLogin) first, wallet second.
 */
export function SignInActions({
  size = "lg",
  className,
}: {
  size?: "lg" | "hero";
  className?: string;
}) {
  const { signIn, signInWithGoogle, signingIn, signInError } = useAuth();
  const account = useCurrentAccount();

  return (
    <div
      className={cn(
        "flex w-full max-w-md flex-col items-center gap-3",
        className
      )}
    >
      <Button
        className={cn(
          connectButtonClasses,
          size === "hero"
            ? "h-12 w-full px-8 text-base"
            : "h-11 w-full px-6"
        )}
        onClick={() => void signInWithGoogle()}
        disabled={signingIn}
      >
        <MailIcon className="size-4" />
        {signingIn ? "Signing you in…" : "Continue with email"}
      </Button>

      <div className="flex w-full items-center gap-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use a wallet
        <span className="h-px flex-1 bg-border" />
      </div>

      {account ? (
        <Button
          variant="outline"
          className="h-11 w-full px-6"
          onClick={() => void signIn()}
          disabled={signingIn}
        >
          <WalletIcon className="size-4" />
          {signingIn ? "Check your wallet…" : "Sign in with wallet"}
        </Button>
      ) : (
        <WalletConnectButton
          variant="outline"
          className="h-11 w-full px-6"
          label="Connect wallet"
        />
      )}

      {signInError && (
        <p className="text-center text-xs text-destructive">{signInError}</p>
      )}

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Email sign-in maps Google to a unique Sui address — the token is
        verified server-side. Wallet users: Sui Wallet, Nightly, Ethos,
        Phantom (Sui) and more.
      </p>
    </div>
  );
}
