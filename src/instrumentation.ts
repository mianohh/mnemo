import { raiseConnectAttemptTimeout } from "./lib/node-connect";

/**
 * Runs once at server startup (Next loads this automatically).
 *
 * The actual work lives in `lib/node-connect.ts` so the split API server
 * (`server/index.ts`, started by `npm run start:api`) can apply the same
 * fix — it runs outside Next and therefore never loads this file.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  console.log(
    "[mnemo] instrumentation: connect attempt timeout =",
    raiseConnectAttemptTimeout(8000),
    "ms"
  );
}
