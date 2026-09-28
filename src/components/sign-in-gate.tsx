"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  BrainCircuitIcon,
  LockIcon,
  MailIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-context";
import {
  WalletConnectButton,
  connectButtonClasses,
} from "@/components/wallet-connect-button";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: <SearchIcon className="size-4" />,
    title: "Semantic recall",
    text: "Every turn starts with a search over your memories on Walrus — relevance-scored, decrypted per request.",
  },
  {
    icon: <SparklesIcon className="size-4" />,
    title: "Durable facts",
    text: "Projects, constraints, decisions and preferences are extracted after each reply and saved as categorized facts.",
  },
  {
    icon: <ShieldCheckIcon className="size-4" />,
    title: "Onchain & portable",
    text: "Encrypted on Walrus, keyed to your sign-in address — verify it any time with a live relayer cross-check.",
  },
] as const;

/**
 * Full-width landing hero shown whenever the visitor has no valid session
 * (chat and /memory both). Connect → sign one challenge → in.
 */
export function SignInGate({
  title = "A chatbot that remembers you.",
  blurb = "Mnemo keeps what matters about you — projects, constraints, decisions, preferences — in decentralized memory on Walrus, and brings it back in every future session.",
}: {
  title?: string;
  blurb?: string;
}) {
  const { signIn, signInWithGoogle, signingIn, signInError } = useAuth();
  const account = useCurrentAccount();

  return (
    <section className="relative overflow-hidden">
      {/* Decorative wash — pure CSS, no assets */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[26rem] w-[52rem] -translate-x-1/2 rounded-full bg-emerald-400/25 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute top-40 -right-24 h-72 w-72 rounded-full bg-teal-300/25 blur-3xl dark:bg-teal-500/10" />
        <div className="absolute top-56 -left-20 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl dark:bg-emerald-600/10" />
      </div>

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-4 py-16 text-center sm:py-24">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <LockIcon className="size-3" />
          Decentralized memory on Walrus — your identity, your namespace
        </span>

        <div className="flex flex-col items-center gap-3">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
            <BrainCircuitIcon className="size-7" />
          </span>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {blurb}
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Button
            className={cn(connectButtonClasses, "h-12 px-7 text-base")}
            onClick={() => void signInWithGoogle()}
            disabled={signingIn}
          >
            <MailIcon className="size-4" />
            {signingIn ? "Signing you in…" : "Continue with email"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Uses your Google account — no wallet, no password.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="h-px w-14 bg-border" />
          or use a wallet
          <span className="h-px w-14 bg-border" />
        </div>

        {account ? (
          <Button
            variant="outline"
            className="h-11 px-6"
            onClick={() => void signIn()}
            disabled={signingIn}
          >
            <WalletIcon className="size-4" />
            {signingIn ? "Check your wallet…" : "Sign in with wallet"}
          </Button>
        ) : (
          <WalletConnectButton
            variant="outline"
            className="h-11 px-6"
            label="Connect wallet"
          />
        )}
        {signInError && (
          <p className="-mt-3 max-w-md text-xs text-destructive">{signInError}</p>
        )}

        <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border/70 bg-card/80 p-4 text-left shadow-xs backdrop-blur-sm"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                {f.icon}
              </span>
              <h2 className="mt-2.5 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {f.text}
              </p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Email sign-in maps your Google account to a unique Sui address — the
          Google token is verified server-side and never reaches the browser.
          Wallet users: Sui Wallet, Nightly, Ethos, Phantom (Sui) and more.
        </p>
      </div>
    </section>
  );
}
