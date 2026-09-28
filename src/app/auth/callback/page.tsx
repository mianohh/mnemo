"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrainCircuitIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-context";

/**
 * OAuth redirect target. Google returns `code` + `state` here; we finish the
 * zkLogin exchange through the auth context (session cookie is set server-side)
 * and land back on the app with a verified session.
 */
export default function AuthCallbackPage() {
  return (
    <SuspenseShell>
      <CallbackFlow />
    </SuspenseShell>
  );
}

function SuspenseShell({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense
      fallback={
        <CallbackStatus>
          <LoaderCircleIcon className="size-6 animate-spin text-emerald-600" />
          <h1 className="text-lg font-semibold">Finishing sign-in…</h1>
          <p className="text-sm text-muted-foreground">
            Verifying your Google account…
          </p>
        </CallbackStatus>
      }
    >
      {children}
    </React.Suspense>
  );
}

function CallbackFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { finishGoogleSignIn, signInError } = useAuth();
  const started = React.useRef(false);

  const oauthError = searchParams.get("error");
  const oauthDescription = searchParams.get("error_description");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  React.useEffect(() => {
    if (started.current || oauthError || !code || !state) return;
    started.current = true;
    void finishGoogleSignIn(code, state).then((ok) => {
      if (ok) router.replace("/");
      // Failure surfaces through `signInError` below.
    });
  }, [oauthError, code, state, finishGoogleSignIn, router]);

  const localError = oauthError
    ? oauthError === "access_denied"
      ? "Sign-in was cancelled."
      : (oauthDescription ?? `Sign-in failed (${oauthError}).`)
    : !code || !state
      ? "Google did not return a sign-in response."
      : null;
  const message = localError ?? signInError;

  if (message) {
    return (
      <CallbackStatus>
        <div className="flex items-center gap-2 text-destructive">
          <TriangleAlertIcon className="size-5" />
          <h1 className="text-lg font-semibold">Sign-in didn&apos;t complete</h1>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/">
          <Button
            size="lg"
            className="bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
          >
            Try again
          </Button>
        </Link>
      </CallbackStatus>
    );
  }

  return (
    <CallbackStatus>
      <LoaderCircleIcon className="size-6 animate-spin text-emerald-600" />
      <h1 className="text-lg font-semibold">Finishing sign-in…</h1>
      <p className="text-sm text-muted-foreground">
        Verifying your Google account…
      </p>
    </CallbackStatus>
  );
}

function CallbackStatus({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
        <BrainCircuitIcon className="size-7" />
      </span>
      {children}
    </section>
  );
}
