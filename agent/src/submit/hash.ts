import { ReasoningCard, type ReasoningCard as ReasoningCardType } from "../../../shared/src/card";
import { cardHash as sharedCardHash } from "../../../shared/src/hash";

export interface HashedCard {
  card: ReasoningCardType;
  cardHash: `0x${string}`;
}

/** Thin wrapper around the shared canonical JSON + keccak256 implementation. */
export function hashFinalizedCard(card: ReasoningCardType): HashedCard {
  const validated = ReasoningCard.parse(card);
  return { card: validated, cardHash: sharedCardHash(validated) };
}