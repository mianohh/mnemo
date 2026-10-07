import { createGoogle } from "@ai-sdk/google";

/**
 * Single place the Gemini model is resolved. The provider is constructed with
 * an explicit apiKey because @ai-sdk/google only auto-reads
 * GOOGLE_GENERATIVE_AI_API_KEY, while this project standardizes on
 * GEMINI_API_KEY (see .env.example).
 *
 * The provider instance is memoized: `createGoogle` sets up internal HTTP
 * clients and it would be wasteful to rebuild them on every chat turn and
 * every fact extraction call.
 */

type GoogleModel = ReturnType<ReturnType<typeof createGoogle>>;

let _provider: ReturnType<typeof createGoogle> | null = null;
let _model: GoogleModel | null = null;
let _modelId: string | null = null;

function getProvider(): ReturnType<typeof createGoogle> {
  if (!_provider) {
    _provider = createGoogle({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _provider;
}

export function geminiModel(): GoogleModel {
  const modelId = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
  // Re-create the model handle only when the model id changes (e.g. hot reload
  // with a different env var). The provider itself is created at most once.
  if (!_model || _modelId !== modelId) {
    _modelId = modelId;
    _model = getProvider()(modelId);
  }
  return _model;
}
