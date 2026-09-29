"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Detect hydration without setState-in-effect: the server snapshot is `false`
// and React immediately re-renders with the client snapshot (`true`).
const subscribe = () => () => {};
const clientMounted = () => true;
const serverNotMounted = () => false;

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    subscribe,
    clientMounted,
    serverNotMounted
  );

  // Render a stable placeholder until mounted to avoid a hydration mismatch.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={cn("size-9 sm:size-8", className)}
        aria-hidden
        tabIndex={-1}
        disabled
      >
        <SunIcon className="size-4 opacity-0" />
      </Button>
    );
  }

  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-9 sm:size-8", className)}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  );
}
