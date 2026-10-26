import { z } from "zod";

export const ExtractedSignal = z
  .object({
    post_id: z.string().min(1),
    has_signal: z.boolean(),
    token: z
      .string()
      .trim()
      .min(1)
      .transform((token) => token.replace(/^\$/, "").toUpperCase())
      .nullable(),
    sentiment: z.enum(["bullish", "bearish", "neutral"]),
    conviction: z.number().finite().min(0).max(1),
    timeframe: z.enum(["short", "medium", "long"]).nullable(),
    price_target: z.number().finite().nonnegative().nullable(),
    is_echo: z.boolean(),
    echo_of: z.string().trim().min(1).nullable(),
    reasoning_summary: z.string().trim().min(1).max(500),
    llm_confidence: z.number().finite().min(0).max(1),
  })
  .strict();

export type ExtractedSignal = z.infer<typeof ExtractedSignal>;