import { z } from "zod";

const probability = z.number().finite().min(0).max(1);
export const AdvisoryStatus = z.enum(["PASS", "FAIL", "UNKNOWN"]);

export const DebateArgument = z
  .object({ argument: z.string().trim().min(1).max(4_000) })
  .strict();

export const AdvisoryRiskRules = z
  .object({
    lead_min_ok: AdvisoryStatus,
    price_deviation_ok: AdvisoryStatus,
    min_mcap_ok: AdvisoryStatus,
    max_position_pct_ok: AdvisoryStatus,
    max_open_ok: z.literal("unknown_requires_onchain_read"),
  })
  .strict();

export const JudgeDecision = z
  .object({
    action: z.enum(["open_long", "open_short", "no_action"]),
    suggested_size_pct: probability,
    verdict: z.string().trim().min(1).max(4_000),
    confidence: probability,
    advisory_risk_rules: AdvisoryRiskRules,
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.action === "no_action" && decision.suggested_size_pct !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggested_size_pct"],
        message: "no_action requires suggested_size_pct of 0",
      });
    }
    if (decision.action !== "no_action" && decision.suggested_size_pct <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggested_size_pct"],
        message: "opening a position requires a positive suggested_size_pct",
      });
    }
  });

export const DebateResult = z
  .object({
    bull: DebateArgument,
    bear: DebateArgument,
    judge: JudgeDecision,
  })
  .strict();

export type DebateArgument = z.infer<typeof DebateArgument>;
export type AdvisoryRiskRules = z.infer<typeof AdvisoryRiskRules>;
export type JudgeDecision = z.infer<typeof JudgeDecision>;
export type DebateResult = z.infer<typeof DebateResult>;