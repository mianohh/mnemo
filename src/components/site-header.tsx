"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { ChevronDownIcon, LogOutIcon, WalletIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  WalletConnectButton,
  connectButtonClasses,
} from "@/components/wallet-connect-button";
import { shortAddress } from "@/lib/sui";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Chat", short: "Chat" },
  { href: "/memory", label: "Memory Network", short: "Memory" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { session, sessionLoading, signIn, signingIn, signOut } = useAuth();
  const account = useCurrentAccount();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center overflow-hidden rounded-lg border-2 border-ink bg-mint dark:border-mint/40">
              <Image
                src="/brand/walrus-mascot.png"
                alt=""
                width={40}
                height={50}
                className="h-7 w-auto -translate-y-px"
              />
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="pixel-font hidden text-[13px] leading-none tracking-tight sm:inline">
                MNEMO
              </span>
              <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">
                on Walrus
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-full px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground sm:px-3 sm:py-1.5 sm:text-sm",
                  pathname === item.href &&
                    "bg-mint font-medium text-mint-on shadow-sm"
                )}
              >
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground md:inline-flex">
            <span className="size-1.5 rounded-full bg-[var(--sui-blue)]" />
            Sui Mainnet
          </span>
          <ThemeToggle />
          {sessionLoading ? (
            <span className="size-8 animate-pulse rounded-full bg-muted" />
          ) : session ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex size-6 items-center justify-center rounded-full bg-mint text-[10px] font-semibold text-mint-on">
                  {session.address.slice(2, 4).toUpperCase()}
                </span>
                <span className="hidden font-medium sm:inline">
                  {shortAddress(session.address)}
                </span>
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">
                    {session.email ?? "Signed in with Sui"}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <div className="px-1.5 pb-1.5 font-mono text-[11px] break-all text-foreground">
                  {session.address}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Memory namespace</DropdownMenuLabel>
                </DropdownMenuGroup>
                <div className="px-1.5 pb-1.5 font-mono text-[11px] break-all text-muted-foreground">
                  {session.namespace}
                </div>
                <p className="px-1.5 pb-1.5 text-xs text-muted-foreground">
                  One isolated namespace on Walrus Memory, derived from your
                  sign-in address. The server never accepts a namespace from
                  the client.
                </p>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOutIcon className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : account ? (
            <Button
              size="lg"
              className={connectButtonClasses}
              onClick={() => void signIn()}
              disabled={signingIn}
            >
              <WalletIcon className="size-4" />
              {signingIn ? "Signing…" : "Sign in"}
            </Button>
          ) : (
            <WalletConnectButton label="Connect wallet" shortLabel="Connect" />
          )}
        </div>
      </div>
    </header>
  );
}
