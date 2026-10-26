import { ReasoningCard, type ReasoningCard as ReasoningCardType } from "../../../shared/src/card";

import { signalIdentityHash } from "./identity";

function finalCardId(card: ReasoningCardType): string {
  const hash = signalIdentityHash(card);
  const sequence = (Number.parseInt(hash.slice(2, 10), 16) % 1_000).toString().padStart(3, "0");
  return `card-${card.token.toLowerCase()}-${card.debate.verdict.toLowerCase()}-${sequence}`;
}

export function finalizeCard(draft: unknown, finalizedAt = new Date()): ReasoningCardType {
  if (Number.isNaN(finalizedAt.getTime())) throw new Error("Finalization timestamp must be valid");
  let parsed: ReasoningCardType;
  try {
    parsed = ReasoningCard.parse(draft);
  } catch (error) {
    throw new Error("Draft does not conform to the final ReasoningCard schema", { cause: error });
  }
  return ReasoningCard.parse({
    ...parsed,
    card_id: finalCardId(parsed),
    created_at: finalizedAt.toISOString(),
  });
}