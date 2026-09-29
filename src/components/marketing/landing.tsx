"use client";

import * as React from "react";
import Image from "next/image";
import {
  ArrowUpRightIcon,
  CheckIcon,
  DatabaseIcon,
  Link2Icon,
  LockIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WorkflowIcon,
} from "lucide-react";
import { SignInActions } from "@/components/sign-in-actions";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  {
    key: "project",
    label: "Projects",
    accent: "text-cat-project",
    icon: <Link2Icon className="size-4" />,
    text: "What you are building, who it is for, and where it stands.",
  },
  {
    key: "constraint",
    label: "Constraints",
    accent: "text-cat-constraint",
    icon: <ShieldCheckIcon className="size-4" />,
    text: "Budgets, deadlines and limits that must never be forgotten.",
  },
  {
    key: "decision",
    label: "Decisions",
    accent: "text-cat-decision",
    icon: <CheckIcon className="size-4" />,
    text: "Architectural choices — and the reasoning that produced them.",
  },
  {
    key: "preference",
    label: "Preferences",
    accent: "text-cat-preference",
    icon: <SparklesIcon className="size-4" />,
    text: "Tone, tools and working style, applied automatically.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "You talk",
    text: "Chat like normal. Mnemo streams replies from Gemini with zero setup.",
  },
  {
    n: "02",
    title: "It extracts",
    text: "A second pass classifies durable facts — max three per turn — and encrypts them with Seal.",
  },
  {
    n: "03",
    title: "Walrus keeps it",
    text: "Facts are anchored as blobs on Walrus and semantically recalled before every future reply.",
  },
] as const;

interface Health {
  ok?: boolean;
  llm?: string;
  network?: "mainnet" | "testnet";
  memwalConfigured?: boolean;
  relayer?: { status?: string; error?: string };
}

function StatusPill({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card px-4 py-3">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        <span
          className={cn(
            "size-1.5 rounded-full",
            ok ? "bg-mint-strong" : "bg-amber-500"
          )}
        />
        {value}
      </span>
    </div>
  );
}

export function Landing() {
  const [health, setHealth] = React.useState<Health | null>(null);
  const [healthState, setHealthState] = React.useState<
    "loading" | "awake" | "sleeping"
  >("loading");

  const checkHealth = React.useCallback(async () => {
    setHealthState("loading");
    try {
      const res = await apiFetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as Health);
      setHealthState("awake");
    } catch {
      // Fetch failed or timed out — usually the free API instance waking up.
      setHealth(null);
      setHealthState("sleeping");
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => void checkHealth(), 0);
    return () => clearTimeout(t);
  }, [checkHealth]);

  const relayerOk = health?.relayer?.status === "ok";
  const pillValue = (value: string) =>
    health ? value : healthState === "sleeping" ? "waking…" : "…";

  return (
    <div className="pb-24">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="pixel-grid mint-wash relative overflow-hidden border-b border-border/70">
        <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center gap-7 px-4 pt-14 pb-16 text-center sm:pt-20">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 py-1 text-xs font-medium backdrop-blur">
            <LockIcon className="size-3 text-mint-ink" />
            Decentralized memory on Walrus — your identity, your namespace
          </span>

          <div className="lockup-plate px-6 py-5 sm:px-10 sm:py-7">
            <Image
              src="/brand/walrus-lockup.png"
              alt="Walrus"
              width={520}
              height={140}
              className="h-20 w-auto sm:h-28"
              priority
            />
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="pixel-font text-xs uppercase tracking-[0.25em] text-mint-ink">
              Mnemo × Walrus × Sui
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-6xl">
              A chatbot that{" "}
              <span className="relative whitespace-nowrap">
                <span className="relative z-10 text-mint-on">
                  remembers you
                </span>
                <span
                  className="absolute inset-x-0 top-3 bottom-1.5 z-0 bg-mint sm:top-4 sm:bottom-2"
                  aria-hidden
                />
              </span>
              .
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Mnemo keeps what matters about you — projects, constraints,
              decisions, preferences — as encrypted, portable memory on
              Walrus, keyed to your Sui address, and brings it back in every
              future session.
            </p>
          </div>

          <SignInActions size="hero" />

          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
            {["Walrus Memory", "Sui Mainnet", "Seal encryption", "zkLogin"].map(
              (t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-card/80 px-2.5 py-1 text-muted-foreground backdrop-blur"
                >
                  {t}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* ── What it keeps ────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="pixel-font text-[11px] uppercase tracking-[0.2em] text-mint-ink">
              What it keeps
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Not transcripts. Durable facts.
            </h2>
          </div>
          <p className="hidden max-w-xs text-right text-xs text-muted-foreground sm:block">
            Noise is discarded after every turn — only state primitives are
            written to Walrus.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <div
              key={c.key}
              className="sticker flex flex-col gap-2 rounded-2xl bg-card p-4 text-left"
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl bg-muted",
                  c.accent
                )}
              >
                {c.icon}
              </span>
              <h3 className={cn("text-sm font-semibold", c.accent)}>
                {c.label}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {c.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-16">
        <p className="pixel-font text-[11px] uppercase tracking-[0.2em] text-mint-ink">
          How it works
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Three steps, one namespace.
        </h2>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5"
            >
              <span className="pixel-font absolute -top-1 right-3 text-5xl text-mint-ink/45 select-none">
                {s.n}
              </span>
              <h3 className="relative text-sm font-semibold">{s.title}</h3>
              <p className="relative mt-2 max-w-[26ch] text-xs leading-relaxed text-muted-foreground">
                {s.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live proof ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-16">
        <div className="sticker overflow-hidden rounded-2xl bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[var(--sui-soft)] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-mint text-mint-on">
                <DatabaseIcon className="size-4" />
              </span>
              <div className="text-left">
                <h3 className="text-sm font-semibold">
                  Live on Walrus, verifiable on Sui
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Every answer shows exactly which memories shaped it.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium">
              <ScanSearchIcon className="size-3 text-mint-ink" />
              mirror ↔ relayer cross-check
            </span>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <StatusPill
              ok={health?.network === "mainnet"}
              label="Network"
              value={pillValue(
                health?.network === "testnet" ? "Sui testnet" : "Sui mainnet"
              )}
            />
            <StatusPill
              ok={!!relayerOk}
              label="Walrus relayer"
              value={pillValue(
                health?.relayer?.status ?? health?.relayer?.error ?? "offline"
              )}
            />
            <StatusPill
              ok={!!health?.memwalConfigured}
              label="Memory index"
              value={pillValue(health?.memwalConfigured ? "connected" : "off")}
            />
          </div>

          {healthState === "sleeping" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/50 px-5 py-3">
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                API instance is asleep — waking it up (can take ~30–60s).
              </span>
              <button
                type="button"
                onClick={() => void checkHealth()}
                className="mint-chip rounded-full px-3 py-1 text-xs font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/70 px-5 py-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <WorkflowIcon className="size-3.5" />
              {health?.llm ?? "Gemini"} generation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheckIcon className="size-3.5" />
              Seal threshold encryption before upload
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpRightIcon className="size-3.5" />
              MCP endpoint for external agents
            </span>
          </div>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pt-16">
        <div className="pixel-grid relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-[var(--mint-soft)] via-background to-[var(--sui-soft)] px-6 py-12 text-center">
          <Image
            src="/brand/walrus-mascot.png"
            alt=""
            width={120}
            height={150}
            className="pointer-events-none absolute -right-4 -bottom-6 hidden h-40 w-auto opacity-25 sm:block"
          />
          <p className="pixel-font text-[11px] uppercase tracking-[0.2em] text-mint-ink">
            Start your memory
          </p>
          <h2 className="mx-auto mt-2 max-w-xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Sign in once. Never reintroduce yourself again.
          </h2>
          <div className="mt-6 flex justify-center">
            <SignInActions />
          </div>
        </div>
      </section>
    </div>
  );
}
