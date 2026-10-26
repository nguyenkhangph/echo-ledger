import { z } from "zod";

export const CONVERGENCE_THRESHOLD = 0.6;

export const CandidateSource = z
  .object({
    post_id: z.string().min(1),
    handle: z.string().min(1),
    sentiment: z.enum(["bullish", "bearish", "neutral"]),
    conviction: z.number().finite().min(0).max(1),
    is_echo: z.boolean(),
    echo_of: z.string().min(1).nullable(),
    reasoning_summary: z.string().trim().min(1).max(500),
  })
  .strict();

export const MarketEvidence = z
  .object({
    price: z.number().finite().nonnegative(),
    change_24h_pct: z.number().finite(),
    market_cap: z.number().finite().nonnegative().nullable(),
    fetched_at: z.string().datetime({ offset: true }),
    source: z.string().min(1),
  })
  .strict();

export const ConvergenceCandidate = z
  .object({
    token: z.string().trim().min(1).transform((token) => token.toUpperCase()),
    window_h: z.number().finite().positive(),
    sources: z.array(CandidateSource).min(1),
    convergence: z
      .object({
        independent_count: z.number().int().nonnegative(),
        echo_count: z.number().int().nonnegative(),
        agreeing_independent_count: z.number().int().nonnegative(),
        score: z.number().finite().min(0).max(1),
        threshold: z.literal(CONVERGENCE_THRESHOLD),
        passed: z.boolean(),
      })
      .strict(),
    evidence: MarketEvidence.nullable(),
  })
  .strict();

export type CandidateSource = z.infer<typeof CandidateSource>;
export type MarketEvidence = z.infer<typeof MarketEvidence>;
export type ConvergenceCandidate = z.infer<typeof ConvergenceCandidate>;