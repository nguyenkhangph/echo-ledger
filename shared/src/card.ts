import { z } from "zod";

const probability = z.number().min(0).max(1);
const nonNegativeNumber = z.number().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();

export const SourceExtract = z
  .object({
    sentiment: z.enum(["bull", "bear", "neutral"]),
    conviction: probability,
    urgency: probability,
  })
  .strict();

export const CardSource = z
  .object({
    kol: z.string().min(1),
    platform: z.enum(["telegram", "x", "discord"]),
    url: z.string().url(),
    posted_at: z.string().datetime({ offset: true }),
    quote: z.string(),
    extract: SourceExtract,
    indep: z.union([z.literal(0.3), z.literal(0.5), z.literal(1.0)]),
    echo_of: z.string().url().optional(),
  })
  .strict();

export const ReasoningCard = z
  .object({
    card_id: z.string().min(1),
    created_at: z.string().datetime({ offset: true }),
    token: z.string().min(1),
    window_h: z.number().positive(),
    sources: z.array(CardSource),
    convergence: z
      .object({
        score: z.number().min(-1).max(1),
        independent_kols: nonNegativeInteger,
        echo_dropped: nonNegativeInteger,
        threshold: z.number().min(-1).max(1),
      })
      .strict(),
    evidence: z
      .object({
        lead_min: z.number(),
        px_change_before_pct: z.number(),
        vol_ratio: nonNegativeNumber,
        price_sources: z.array(z.string().min(1)),
      })
      .strict(),
    debate: z
      .object({
        bull: z.string(),
        bear: z.string(),
        verdict: z.enum(["APPROVE", "REJECT", "HOLD"]),
        confidence: probability,
        models: z.array(z.string().min(1)),
      })
      .strict(),
    risk_rules: z
      .object({
        max_position_pct: probability,
        max_open: nonNegativeInteger,
        stop_loss_pct: probability,
        min_mcap_usd: nonNegativeNumber,
        horizon_h: z.number().positive(),
      })
      .strict(),
    models: z
      .object({
        extract_model: z.string().min(1),
        judge_model: z.string().min(1),
        prompt_hashes: z.record(z.string()),
      })
      .strict(),
    decision: z
      .object({
        side: z.enum(["long", "short", "none"]),
        size_pct: probability,
      })
      .strict(),
  })
  .strict();

export type ReasoningCard = z.infer<typeof ReasoningCard>;