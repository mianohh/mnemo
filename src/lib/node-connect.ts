/**
 * Node's happy-eyeballs connection attempts default to a 250 ms budget per
 * address. On networks where a TCP handshake to Google takes longer than
 * that, every attempt is aborted before it completes and `fetch` fails with
 * UND_ERR_CONNECT_TIMEOUT — which surfaces during zkLogin as
 * "Could not reach Google". Give connections a realistic budget instead.
 *
 * `process.getBuiltinModule` (Node >= 22.3) is used instead of an `import`
 * statement so bundling this file for a runtime that never reaches the call
 * doesn't try to resolve `node:net`.
 *
 * Called from both entry points: Next's `instrumentation.ts` (local dev and
 * `next start`) and `server/index.ts` (the split API that Render actually
 * runs — `npm run start:api` never loads Next, so anything left only in
 * `instrumentation.ts` is dead code in production).
 */
export function raiseConnectAttemptTimeout(ms = 8000): number | undefined {
  const net = (
    process as unknown as {
      getBuiltinModule?: (id: string) => typeof import("node:net");
    }
  ).getBuiltinModule?.("node:net");
  net?.setDefaultAutoSelectFamilyAttemptTimeout?.(ms);
  return net?.getDefaultAutoSelectFamilyAttemptTimeout?.();
}
