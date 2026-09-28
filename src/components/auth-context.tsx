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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const { mutateAsync: disconnectAsync } = useDisconnectWallet();
  const { mutateAsync: signPersonalMessageAsync } = useSignPersonalMessage();

  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const autoTriedFor = React.useRef<string | null>(null);

  const forgetMode = React.useSyncExternalStore(
    subscribeForget,
    getForgetSnapshot,
    getServerForgetSnapshot
  );

  const refreshSession = React.useCallback(async () => {
    try {
      const res = await apiFetch("/api/auth/session", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Session;
        setSession(data);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
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
    setSignInError(null);
    try {
      // Navigates to Google; the callback page finishes the sign-in.
      await beginZkLogin();
      return true;
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : "Sign-in failed");
      setSigningIn(false);
      return false;
    }
  }, []);

  const finishGoogleSignIn = React.useCallback(
    async (code: string, state: string): Promise<boolean> => {
      setSigningIn(true);
      setSignInError(null);
      try {
        const identity = await completeZkLogin({ code, state });
        setSession({
          address: identity.address,
          namespace: addressNamespace(identity.address),
          email: identity.email,
        });
        return true;
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : "Sign-in failed");
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    []
  );

  const signOut = React.useCallback(async () => {
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
