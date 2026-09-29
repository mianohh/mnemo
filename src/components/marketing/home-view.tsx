"use client";

import { ChatClient } from "@/components/chat/chat-client";
import { Landing } from "@/components/marketing/landing";
import { useAuth } from "@/components/auth-context";

/**
 * No loading gate: the landing paints immediately and swaps to the chat
 * once the (background) session check confirms a sign-in. Blocking on
 * `/api/auth/session` here meant new visitors stared at a skeleton for as
 * long as the API took to wake up.
 */
export function HomeView() {
  const { session } = useAuth();

  if (session) return <ChatClient />;
  return <Landing />;
}
