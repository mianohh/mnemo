import { generateObject } from "ai";
import { z } from "zod";
import { geminiModel } from "@/lib/llm";
import type { SavedFact } from "./types";

const schema = z.object({
  facts: z.array(
    z.object({
      category: z.enum(["project", "constraint", "decision", "preference"]),
      text: z
        .string()
        .describe(
          "One durable, self-contained fact about the user, written in third person."
        ),
    })
  ),
});

const EXTRACTION_PROMPT = `You extract durable facts about a user from one exchange with a personal assistant. These facts will be stored in decentralized memory and recalled in future sessions weeks later, so only keep what is still true and useful then.

Categories:
- project: what they are building/working on (names, stack, goals, timelines)
- constraint: hard limits they operate under (budget, compliance, deadlines, tech restrictions)
- decision: a choice they made, ideally with the reason ("chose Sui over EVM because...")
- preference: how they like to work with an assistant (tone, tools, formats, workflows)

Rules:
- Extract AT MOST 3 facts per turn; 0 is often correct.
- Always keep identity facts when stated (name, role, employer, location) — e.g. "Name is TestUser", "Role is security engineer". These matter most when recalled weeks later.
- Skip pleasantries, thanks, small talk, weather, and one-off questions.
- Skip anything already obvious only from this turn and not durable (e.g. "what time is it").
- Each fact must stand alone without the surrounding conversation. No "the user said", no pronouns like "he/she". Start with the substance: "Building X on Y", "Budget capped at $25/mo", "Prefers PostgreSQL over MongoDB".
- Never invent facts. Only what the human actually stated.
- If the human corrects earlier information, store the corrected version as a new fact.`;

export async function extractFacts(
  userMessage: string,
  assistantReply: string
): Promise<SavedFact[]> {
  if (!process.env.GEMINI_API_KEY) return [];
  const trimmed = userMessage.trim();
  if (trimmed.length < 15) return [];

  try {
    const { object } = await generateObject({
      model: geminiModel(),
      schema,
      temperature: 0,
      maxRetries: 3,
      system: EXTRACTION_PROMPT,
      prompt: `Exchange with the assistant:\n\nHuman:\n${trimmed}\n\nAssistant:\n${assistantReply.slice(0, 2000)}`,
    });

    return object.facts
      .filter((f) => f.text.trim().length >= 8 && f.text.trim().length <= 400)
      .slice(0, 3)
      .map((f) => ({
        category: f.category as SavedFact["category"],
        text: f.text.trim(),
      }));
  } catch (e) {
    console.error("[mnemo] fact extraction failed:", e);
    return [];
  }
}
