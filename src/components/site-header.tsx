"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import {
  BrainCircuitIcon,
  ChevronDownIcon,
  LogOutIcon,
  WalletIcon,
} from "lucide-react";
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
  { href: "/", label: "Chat" },
  { href: "/memory", label: "Memory Network" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { session, sessionLoading, signIn, signingIn, signOut } = useAuth();
  const account = useCurrentAccount();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-emerald-600 text-white shadow-xs">
              <BrainCircuitIcon className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Mnemo AI
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  pathname === item.href &&
                    "bg-muted font-medium text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {sessionLoading ? (
            <span className="size-8 animate-pulse rounded-full bg-muted" />
          ) : session ? (
            <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
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
                sign-in address. The server never accepts a namespace from the
                client.
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
          <WalletConnectButton />
        )}
        </div>
      </div>
    </header>
  );
}
