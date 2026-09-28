/**
 * Runs once at server startup (Next loads this automatically).
 *
 * Node's happy-eyeballs connection attempts default to a 250ms budget per
 * address. On networks where a TCP handshake to Google takes longer than
 * that, every attempt is aborted before it completes and `fetch` fails with
 * UND_ERR_CONNECT_TIMEOUT — which surfaces during zkLogin as
 * "Could not reach Google". Give connections a realistic budget instead.
 *
 * `process.getBuiltinModule` (Node >= 22.3) is used instead of an `import`
 * statement so the Edge-Runtime compilation of this file — which never
 * reaches this line — doesn't try to bundle `node:net`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const net = (
    process as unknown as {
      getBuiltinModule?: (id: string) => typeof import("node:net");
    }
  ).getBuiltinModule?.("node:net");
  net?.setDefaultAutoSelectFamilyAttemptTimeout?.(8000);
  console.log(
    "[mnemo] instrumentation: connect attempt timeout =",
    net?.getDefaultAutoSelectFamilyAttemptTimeout?.(),
    "ms"
  );
}
