import { z } from "zod";

export const ExtractedSignal = z
  .object({
    post_id: z.string().min(1),
    has_signal: z.boolean(),
    is_sponsored: z.boolean().default(false),
    sponsorship_reason: z.string().trim().min(1).max(300).nullable().default(null),
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
  .strict()
  .superRefine((signal, context) => {
    if (signal.is_sponsored && signal.has_signal) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Sponsored posts cannot be actionable signals", path: ["has_signal"] });
    }
    if (signal.is_sponsored && signal.sponsorship_reason === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Sponsored posts require sponsorship_reason", path: ["sponsorship_reason"] });
    }
    if (!signal.is_sponsored && signal.sponsorship_reason !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Non-sponsored posts must use a null sponsorship_reason", path: ["sponsorship_reason"] });
    }
  });

export type ExtractedSignal = z.infer<typeof ExtractedSignal>;