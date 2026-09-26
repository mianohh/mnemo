"use client";

import * as React from "react";
import Link from "next/link";
import {
  BotIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  DatabaseIcon,
  EyeIcon,
  EyeOffIcon,
  Link2Icon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth-context";
import { SignInGate } from "@/components/sign-in-gate";
import { apiFetch } from "@/lib/api";
import { shortAddress } from "@/lib/sui";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  type MirrorMemory,
} from "@/lib/memory/types";
import { cn } from "@/lib/utils";

interface MemoryResponse {
  address: string;
  namespace: string;
  mirrorCount: number;
  counts: Record<Category, number>;
  chain: { count?: number; storageBytes?: number; error?: string };
  mcp?: { url: string; token: string };
  grouped: Record<Category, MirrorMemory[]>;
}

interface HealthResponse {
  ok: boolean;
  llm: string;
  memwalConfigured: boolean;
  network: "mainnet" | "testnet";
  relayer: { status?: string; version?: string; error?: string };
  geminiConfigured: boolean;
}

const CATEGORY_STYLES: Record<Category, { icon: React.ReactNode; accent: string }> = {
  project: { icon: <Link2Icon className="size-3.5" />, accent: "text-blue-600" },
  constraint: { icon: <ShieldCheckIcon className="size-3.5" />, accent: "text-amber-600" },
  decision: { icon: <CheckCircle2Icon className="size-3.5" />, accent: "text-violet-600" },
  preference: { icon: <BrainCircuitIcon className="size-3.5" />, accent: "text-emerald-600" },
};

export function MemoryDashboard() {
  const { session, sessionLoading } = useAuth();

  if (sessionLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Skeleton key={c} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <SignInGate
        title="Your memory network."
        blurb="Every wallet gets its own namespace. Connect and sign once to see what Mnemo has anchored to Walrus for you — with a live cross-check against the relayer."
      />
    );
  }
  // Remount per address so one wallet's cached rows can never flash for another.
  return <Dashboard key={session.address} address={session.address} />;
}

function Dashboard({ address }: { address: string }) {
  const [data, setData] = React.useState<MemoryResponse | null>(null);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [showToken, setShowToken] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [memRes, healthRes] = await Promise.all([
        apiFetch("/api/memory", { cache: "no-store" }),
        apiFetch("/api/health", { cache: "no-store" }),
      ]);
      if (!memRes.ok) throw new Error(`memory API ${memRes.status}`);
      setData((await memRes.json()) as MemoryResponse);
      setHealth((await healthRes.json()) as HealthResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Deferred so the effect body itself contains no direct state updates;
    // the fetch still starts on mount (and is cancelled if user switches).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const hasPending = React.useMemo(
    () =>
      data &&
      CATEGORIES.some((c) =>
        data.grouped[c].some((m) => m.status === "pending")
      ),
    [data]
  );

  // While writes are still indexing on Walrus, poll so status flips to done.
  React.useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [hasPending, load]);

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1200);
  };

  const chainOk =
    data?.chain.count !== undefined && data.chain.count === data.mirrorCount;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-emerald-50 via-background to-teal-50 px-5 py-5 dark:from-emerald-950/50 dark:via-background dark:to-teal-950/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs">
                <DatabaseIcon className="size-4" />
              </span>
              Memory Network
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Everything Mnemo has anchored to Walrus for{" "}
              <span className="font-mono font-medium text-foreground">
                {shortAddress(address)}
              </span>
              , grouped by type.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCwIcon className="size-3.5" /> Refresh
          </Button>
        </div>

        {/* Status badges */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="font-mono">
            {data?.namespace ?? "…"}
          </Badge>
          {health && (
            <>
              <Badge variant="outline">
                {health.network === "testnet" ? "testnet" : "mainnet"}
              </Badge>
              <Badge variant="outline">{health.llm}</Badge>
              <Badge
                variant="outline"
                className={cn(
                  health.memwalConfigured
                    ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                    : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                )}
              >
                memwal: {health.memwalConfigured ? "configured" : "unconfigured"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  health.relayer.status === "ok"
                    ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                    : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                )}
              >
                relayer: {health.relayer.status ?? health.relayer.error ?? "?"}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="gap-2 py-4">
          <CardContent className="px-4">
            <p className="text-xs font-medium text-muted-foreground">
              Memories stored
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">
              {data ? data.mirrorCount : "…"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              durable facts in this namespace
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardContent className="px-4">
            <p className="text-xs font-medium text-muted-foreground">
              By category
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-medium",
                    CATEGORY_STYLES[cat].accent
                  )}
                >
                  {CATEGORY_STYLES[cat].icon}
                  {data ? data.counts[cat] : "…"}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              extracted automatically after each turn
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardContent className="px-4">
            <p className="text-xs font-medium text-muted-foreground">
              Onchain cross-check
            </p>
            <p
              className={cn(
                "mt-1 text-3xl font-semibold tracking-tight",
                chainOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              )}
            >
              {data ? `${data.mirrorCount} ↔ ${data.chain.count ?? "—"}` : "…"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {chainOk ? (
                <>
                  mirror matches the relayer ✓
                  {data?.chain.storageBytes !== undefined && (
                    <> · {(data.chain.storageBytes / 1024).toFixed(1)} KB on Walrus</>
                  )}
                </>
              ) : (
                "local mirror vs relayer listNamespaces()"
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {data?.chain.error && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          Relayer cross-check failed: {data.chain.error}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <Separator className="my-6" />

      {/* MCP connection */}
      {data?.mcp && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <span className="text-emerald-600">
                <BotIcon className="size-4" />
              </span>
              Connect any AI agent — MCP
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-4">
            <p className="text-xs text-muted-foreground">
              This token is scoped to{" "}
              <code className="rounded bg-muted px-1">{data.namespace}</code>{" "}
              and grants read + write over its memories. Treat it like a
              password — anyone holding it can read and permanently add facts.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                Endpoint
              </span>
              <code className="flex-1 truncate font-mono text-xs">
                {data.mcp.url}
              </code>
              <button
                onClick={() => void copy(data.mcp!.url)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Copy endpoint"
              >
                <CopyIcon className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                Token
              </span>
              <code className="flex-1 truncate font-mono text-xs">
                {showToken ? data.mcp.token : "mnemo.".padEnd(14, "•")}
              </code>
              <button
                onClick={() => setShowToken((v) => !v)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title={showToken ? "Hide token" : "Reveal token"}
              >
                {showToken ? (
                  <EyeOffIcon className="size-3.5" />
                ) : (
                  <EyeIcon className="size-3.5" />
                )}
              </button>
              <button
                onClick={() => void copy(data.mcp!.token)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="Copy token"
              >
                <CopyIcon className="size-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-[11px]"
                onClick={() =>
                  void copy(
                    `claude mcp add --transport http mnemo ${data.mcp!.url} --header "Authorization: Bearer ${data.mcp!.token}"`
                  )
                }
              >
                {copied?.startsWith("claude mcp add")
                  ? "Copied!"
                  : "Copy Claude Code command"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-[11px]"
                onClick={() =>
                  void copy(
                    JSON.stringify(
                      {
                        mcp: {
                          mnemo: {
                            type: "streamable-http",
                            url: data.mcp!.url,
                            headers: {
                              Authorization: `Bearer ${data.mcp!.token}`,
                            },
                          },
                        },
                      },
                      null,
                      2
                    )
                  )
                }
              >
                {copied?.startsWith("{") ? "Copied!" : "Copy client JSON"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tools: <code className="rounded bg-muted px-1">mnemo_recall</code>{" "}
              <code className="rounded bg-muted px-1">mnemo_remember</code>{" "}
              <code className="rounded bg-muted px-1">mnemo_list_memories</code>{" "}
              <code className="rounded bg-muted px-1">mnemo_health</code> — the
              namespace is derived from the token, never from tool arguments.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Skeleton key={c} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : data && data.mirrorCount === 0 && !hasPending ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
            <BrainCircuitIcon className="size-6" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              No memories yet
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Chat with Mnemo about your projects, constraints or preferences —
              durable facts get extracted after each turn and anchored to
              Walrus here.
            </p>
          </div>
          <Link href="/">
            <Button className={cn("mt-1 bg-emerald-600 text-white hover:bg-emerald-700")}>
              Start chatting
            </Button>
          </Link>
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {CATEGORIES.map((cat) => {
            const items = data.grouped[cat];
            const style = CATEGORY_STYLES[cat];
            return (
              <Card key={cat} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle
                    className={cn(
                      "flex items-center justify-between text-sm font-medium",
                      style.accent
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {style.icon}
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      {items.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 px-4">
                  {items.length === 0 && (
                    <p className="py-2 text-xs text-muted-foreground">
                      Nothing here yet — chat with Mnemo about something in
                      this category.
                    </p>
                  )}
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className="group rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
                    >
                      <div className="flex items-start gap-2">
                        {m.status === "pending" ? (
                          <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-amber-500" />
                        ) : (
                          <CheckCircle2Icon
                            className={cn(
                              "mt-0.5 size-3.5 shrink-0",
                              m.status === "done"
                                ? "text-emerald-600"
                                : "text-destructive"
                            )}
                          />
                        )}
                        <p className="flex-1 text-xs leading-relaxed">
                          {m.text}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 pl-5 font-mono text-[10px] text-muted-foreground">
                        <span>{m.createdAt.slice(0, 16).replace("T", " ")}</span>
                        {m.blobId ? (
                          <button
                            onClick={() => void copy(m.blobId!)}
                            title={m.blobId}
                            className="flex items-center gap-1 hover:text-foreground"
                          >
                            {copied === m.blobId ? (
                              "copied!"
                            ) : (
                              <>
                                {m.blobId.slice(0, 6)}…{m.blobId.slice(-4)}
                                <CopyIcon className="size-3" />
                              </>
                            )}
                          </button>
                        ) : (
                          <span>
                            {m.status === "pending"
                              ? "uploading…"
                              : m.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        Cross-check compares the local mirror (this app&apos;s Postgres log of
        every fact it saved) against{" "}
        <code className="rounded bg-muted px-1">listNamespaces()</code> from
        the Walrus Memory relayer — proof the memories really live onchain and
        not just in a local cache.
      </p>
    </div>
  );
}
