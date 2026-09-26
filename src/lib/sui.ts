// Pure, isomorphic helpers shared by server routes and client components
// (client-safe — sui-auth.ts builds the session layer on top).

export function isSuiAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** One isolated Walrus Memory namespace per Sui address. */
export function addressNamespace(address: string): string {
  return `mnemo-user-${address.toLowerCase()}`;
}

/** Human-facing identity for prompts/UI: 0x1234…abcd */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The exact challenge text both client and server agree on. */
export function signinMessage(issuedAt: number): string {
  return `Sign in to Mnemo AI\nIssued-At: ${issuedAt}`;
}
