import { describe, expect, test } from "bun:test";

import { ReasoningCard } from "../../../shared/src/card";
import { approveLongCard } from "../../../shared/src/fixtures";
import { cardHash } from "../../../shared/src/hash";
import { finalizeCard } from "./finalize";
import { hashFinalizedCard } from "./hash";

describe("card finalization", () => {
  test("sets the final timestamp, follows the card ID convention, validates, and uses the shared hash", () => {
    const finalized = finalizeCard(
      { ...approveLongCard, card_id: "draft-sol-placeholder", created_at: "2020-01-01T00:00:00.000Z" },
      new Date("2026-10-26T09:30:00.000Z"),
    );
    const result = hashFinalizedCard(finalized);

    expect(ReasoningCard.parse(result.card)).toEqual(finalized);
    expect(finalized.created_at).toBe("2026-10-26T09:30:00.000Z");
    expect(finalized.card_id).toMatch(/^card-sol-approve-\d{3}$/);
    expect(result.cardHash).toBe(cardHash(finalized));
  });

  test("rejects a malformed draft with a clear reason", () => {
    expect(() => finalizeCard({ ...approveLongCard, decision: { side: "long", size_pct: 2 } }))
      .toThrow("Draft does not conform to the final ReasoningCard schema");
  });
});