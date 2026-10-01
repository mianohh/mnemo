"use client";

import * as React from "react";
import {
  useCurrentAccount,
  useDisconnectWallet,
  useSignPersonalMessage,
} from "@mysten/dapp-kit";
import { addressNamespace, signinMessage } from "@/lib/sui";
import { apiFetch } from "@/lib/api";
import { beginZkLogin, clearZkLoginCache, completeZkLogin } from "@/lib/zklogin";

const FORGET_KEY = "mnemo:forget";

export interface Session {
  address: string;
  namespace: string;
  /** Display-only identity from the OAuth token (zkLogin sign-ins). */
  email?: string;
}

interface AuthState {
  /** Verified session (httpOnly cookie) — the server's source of truth. */
  session: Session | null;
  sessionLoading: boolean;
  /** True while a connected wallet is prompting for the sign-in signature. */
  signingIn: boolean;
  signInError: string | null;
  /** Requires a connected wallet; creates the session cookie. */
  signIn: () => Promise<boolean>;
  /**
   * zkLogin email sign-in: starts the Google OAuth redirect (which does not
   * resolve); the `/auth/callback` page finishes it.
   */
  signInWithGoogle: () => Promise<boolean>;
  /** Completes the `/auth/callback` redirect and sets the session cookie. */
  finishGoogleSignIn: (code: string, state: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  forgetMode: boolean;
  setForgetMode: (value: boolean) => void;
}

const AuthContext = React.createContext<AuthState | null>(null);

// Tiny external store over localStorage so forget mode survives reloads
// without setState-in-effect or hydration mismatches.
const forgetListeners = new Set<() => void>();
let cachedForget: boolean | undefined;

function notifyForget() {
  for (const listener of forgetListeners) listener();
}

function subscribeForget(listener: () => void) {
  forgetListeners.add(listener);
  return () => {
    forgetListeners.delete(listener);
  };
}

function getForgetSnapshot(): boolean {
  if (cachedForget === undefined) {
    cachedForget = window.localStorage.getItem(FORGET_KEY) === "1";
  }
  return cachedForget;
}

function getServerForgetSnapshot(): boolean {
  return false;
}

/**
 * True while the browser is on the OAuth redirect target with a `code` from
 * Google. The session cookie cannot exist yet on that navigation, so the only
 * answer a session probe can give is 401.
 */
function isOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.pathname === "/auth/callback" &&
    new URLSearchParams(window.location.search).has("code")
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const { mutateAsync: disconnectAsync } = useDisconnectWallet();
  const { mutateAsync: signPersonalMessageAsync } = useSignPersonalMessage();

  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const autoTriedFor = React.useRef<string | null>(null);
  /**
   * Bumped whenever a sign-in starts, succeeds, or ends. An in-flight
   * `refreshSession` captures the value before it awaits and discards its
   * result if it moved — otherwise the 401 it collected before the cookie
   * existed lands *after* the exchange created one and silently signs the
   * user back out.
   */
  const sessionEpoch = React.useRef(0);
  /** Read synchronously, unlike `signingIn`, so guards see the update at once. */
  const signingInRef = React.useRef(false);

  const forgetMode = React.useSyncExternalStore(
    subscribeForget,
    getForgetSnapshot,
    getServerForgetSnapshot
  );

  const refreshSession = React.useCallback(async () => {
    const epoch = sessionEpoch.current;
    try {
      if (signingInRef.current || isOAuthCallback()) return;
      const res = await apiFetch("/api/auth/session", { cache: "no-store" });
      // A sign-in began while this was in flight; its result is newer than
      // ours, so a stale 401 must not wipe it.
      if (epoch !== sessionEpoch.current) return;
      if (res.ok) {
        const data = (await res.json()) as Session;
        setSession(data);
      } else {
        setSession(null);
      }
    } catch {
      if (epoch === sessionEpoch.current) setSession(null);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Deferred so the effect body itself contains no direct state updates
    // (same pattern as the dashboard's loader).
    const t = setTimeout(() => void refreshSession(), 0);
    return () => clearTimeout(t);
  }, [refreshSession]);

  const signIn = React.useCallback(async (): Promise<boolean> => {
    if (!account) {
      setSignInError("Connect a wallet first");
      return false;
    }
    setSigningIn(true);
    signingInRef.current = true;
    sessionEpoch.current += 1;
    setSignInError(null);
    try {
      const text = signinMessage(Date.now());
      const { bytes, signature } = await signPersonalMessageAsync({
        message: new TextEncoder().encode(text),
      });
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: bytes,
          signature,
          address: account?.address,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSignInError(data.error ?? `Sign-in failed (${res.status})`);
        return false;
      }
      const { address } = (await res.json()) as { address: string };
      setSession({ address, namespace: addressNamespace(address) });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSignInError(
        /reject|declin|cancel/i.test(msg)
          ? "Signature request declined"
          : "Sign-in failed"
      );
      return false;
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  }, [account, signPersonalMessageAsync]);

  // Wallet connected but no valid session → prompt the signature once per
  // address (auto-connect on reload resumes silently).
  React.useEffect(() => {
    if (!account || session || sessionLoading || signingIn) return;
    if (autoTriedFor.current === account.address) return;
    autoTriedFor.current = account.address;
    void signIn();
  }, [account, session, sessionLoading, signingIn, signIn]);

  const signInWithGoogle = React.useCallback(async (): Promise<boolean> => {
    setSigningIn(true);
    signingInRef.current = true;
    sessionEpoch.current += 1;
    setSignInError(null);
    try {
      // Navigates to Google; the callback page finishes the sign-in.
      await beginZkLogin();
      return true;
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : "Sign-in failed");
      signingInRef.current = false;
      setSigningIn(false);
      return false;
    }
  }, []);

  const finishGoogleSignIn = React.useCallback(
    async (code: string, state: string): Promise<boolean> => {
      // Invalidate every session probe already in flight before we create the
      // cookie, so none of them can land afterwards and clear it.
      sessionEpoch.current += 1;
      signingInRef.current = true;
      setSigningIn(true);
      setSignInError(null);
      try {
        await completeZkLogin({ code, state });
        // The cookie is the source of truth. Reading it back means a browser
        // that dropped the sign-in cookie fails loudly here instead of
        // silently signing the user out on the next reload.
        const res = await apiFetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(
            "Your browser blocked the sign-in cookie — allow cookies and site data for this site, then try again."
          );
        }
        setSession((await res.json()) as Session);
        return true;
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : "Sign-in failed");
        return false;
      } finally {
        signingInRef.current = false;
        setSigningIn(false);
      }
    },
    []
  );

  const signOut = React.useCallback(async () => {
    // Invalidate any in-flight refresh so it cannot restore the session we
    // are about to clear.
    sessionEpoch.current += 1;
    clearZkLoginCache();
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setSession(null);
      autoTriedFor.current = null;
      try {
        await disconnectAsync();
      } catch {
        /* wallet already gone */
      }
    }
  }, [disconnectAsync]);

  const setForgetMode = React.useCallback((next: boolean) => {
    cachedForget = next;
    window.localStorage.setItem(FORGET_KEY, next ? "1" : "0");
    notifyForget();
  }, []);

  const value = React.useMemo<AuthState>(
    () => ({
      session,
      sessionLoading,
      signingIn,
      signInError,
      signIn,
      signInWithGoogle,
      finishGoogleSignIn,
      signOut,
      forgetMode,
      setForgetMode,
    }),
    [
      session,
      sessionLoading,
      signingIn,
      signInError,
      signIn,
      signInWithGoogle,
      finishGoogleSignIn,
      signOut,
      forgetMode,
      setForgetMode,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
