import { createGoogle } from "@ai-sdk/google";

/**
 * Single place the Gemini model is resolved. The provider is constructed with
 * an explicit apiKey because @ai-sdk/google only auto-reads
 * GOOGLE_GENERATIVE_AI_API_KEY, while this project standardizes on
 * GEMINI_API_KEY (see .env.example).
 */
export function geminiModel() {
  const provider = createGoogle({ apiKey: process.env.GEMINI_API_KEY });
  return provider(process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest");
}
