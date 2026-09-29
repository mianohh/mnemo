"use client";

import Image from "next/image";
import {
  LockIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { SignInActions } from "@/components/sign-in-actions";

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
 * Compact sign-in wall for routes that need a session but no marketing page
 * (e.g. /memory). The `/` route uses the full landing page instead.
 */
export function SignInGate({
  title = "A chatbot that remembers you.",
  blurb = "Mnemo keeps what matters about you — projects, constraints, decisions, preferences — in decentralized memory on Walrus, and brings it back in every future session.",
}: {
  title?: string;
  blurb?: string;
}) {
  return (
    <section className="pixel-grid mint-wash relative overflow-hidden">
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-7 px-4 py-16 text-center sm:py-20">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 py-1 text-xs font-medium backdrop-blur">
          <LockIcon className="size-3 text-mint-ink" />
          Decentralized memory on Walrus — your identity, your namespace
        </span>

        <div className="lockup-plate px-6 py-5 sm:px-9 sm:py-6">
          <Image
            src="/brand/walrus-lockup.png"
            alt="Walrus"
            width={440}
            height={120}
            className="h-16 w-auto sm:h-20"
            priority
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          <p className="pixel-font text-[11px] uppercase tracking-[0.25em] text-mint-ink">
            Mnemo × Walrus × Sui
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {blurb}
          </p>
        </div>

        <SignInActions />

        <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="sticker-sm rounded-xl bg-card p-4 text-left"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-mint/40 text-mint-ink">
                {f.icon}
              </span>
              <h2 className="mt-2.5 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
