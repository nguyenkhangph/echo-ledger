export const ADVISORY_RISK_CONFIG = {
  max_position_pct: 0.05,
  max_open: 3,
  stop_loss_pct: 0.08,
  min_mcap_usd: 10_000_000,
  horizon_h: 24,
} as const;

/**
 * Agent-side values are advisory metadata only. LLM output is never trusted inside CRE.
 * CRE must independently read finalized on-chain state and enforce its deterministic gate.
 */
export type AdvisoryRiskConfig = typeof ADVISORY_RISK_CONFIG;