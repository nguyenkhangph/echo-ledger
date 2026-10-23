import { describe, expect, test } from "bun:test";

import { ReasoningCard } from "../src/card";
import {
  approveLongCard,
  exampleCards,
  rejectNarrativeChasingCard,
  rejectRiskRuleCard,
} from "../src/fixtures";

describe("ReasoningCard", () => {
  test.each(exampleCards)("validates fixture $card_id", (card) => {
    expect(ReasoningCard.parse(card)).toEqual(card);
  });

  test("includes an approved long decision", () => {
    expect(approveLongCard.debate.verdict).toBe("APPROVE");
    expect(approveLongCard.decision.side).toBe("long");
  });

  test("rejects a narrative that chases price", () => {
    expect(rejectNarrativeChasingCard.evidence.lead_min).toBeLessThan(0);
    expect(rejectNarrativeChasingCard.debate.verdict).toBe("REJECT");
    expect(rejectNarrativeChasingCard.decision.side).toBe("none");
  });

  test("includes a risk-rule rejection", () => {
    expect(rejectRiskRuleCard.debate.verdict).toBe("REJECT");
    expect(rejectRiskRuleCard.debate.bear).toContain("market cap");
    expect(rejectRiskRuleCard.decision.side).toBe("none");
  });
});