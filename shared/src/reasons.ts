import type { LedgerPosition } from "./ledger";

/**
 * Reason codes written by the CRE record workflow's risk gate (cre/record/workflow.ts, riskGate).
 * The contract stores the number; this table is the plain-language meaning.
 */
export const REASONS: Record<number, { code: string; text: string; attestation: LedgerPosition["attestation"] }> = {
  0: { code: "approved", text: "All risk rules passed; the requested size was within limits.", attestation: "APPROVE" },
  1001: { code: "lead_min_negative", text: "The narrative did not lead the price move.", attestation: "REJECT" },
  1002: { code: "price_sources_disagree_gt_1pct", text: "The three price sources disagreed by more than 1%.", attestation: "REJECT" },
  1003: { code: "market_cap_below_minimum", text: "Market capitalisation was below the card's minimum.", attestation: "REJECT" },
  1004: { code: "max_open_reached", text: "The maximum number of open positions was already reached.", attestation: "REJECT" },
  1005: { code: "card_decision_is_none", text: "After the bull/bear debate the judge decided not to trade.", attestation: "REJECT" },
  1006: { code: "size_constrained_to_max_position_pct", text: "The requested size exceeded the limit and was cut to the maximum.", attestation: "CONSTRAIN" },
};

export function reasonFor(position: Pick<LedgerPosition, "reasonCode">) {
  if (position.reasonCode === undefined) return null;
  return REASONS[position.reasonCode] ?? { code: `code_${position.reasonCode}`, text: `Unrecognised reason code ${position.reasonCode}.`, attestation: null };
}
