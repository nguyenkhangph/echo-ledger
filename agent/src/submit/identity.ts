import type { ReasoningCard } from "../../../shared/src/card";
import { cardHash } from "../../../shared/src/hash";

export function sourcePostId(source: ReasoningCard["sources"][number]): string {
  return `${source.platform}:${new URL(source.url).pathname.replace(/^\//, "")}`;
}

export function sourcePostIds(card: Pick<ReasoningCard, "sources">): string[] {
  return card.sources.map(sourcePostId).sort();
}

export function signalIdentity(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): {
  token: string;
  window_h: number;
  source_post_ids: string[];
} {
  return {
    token: card.token.toUpperCase(),
    window_h: card.window_h,
    source_post_ids: sourcePostIds(card),
  };
}

export function signalIdentityHash(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): `0x${string}` {
  return cardHash(signalIdentity(card));
}