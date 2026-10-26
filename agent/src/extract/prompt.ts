import type { IngestedPost } from "../ingest/types";

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured crypto trading signals from public KOL posts for PRACTICE/paper-trading research only.

Return exactly one JSON object and no prose or Markdown. Follow these rules:
- Set has_signal=false when there is no actionable crypto market call or directional thesis. News, jokes, greetings, and generic education are not signals.
- Set is_sponsored=true and has_signal=false when the post's primary character is a paid promotion or sponsored push rather than the author's genuine independent analysis. Strong evidence includes explicit disclosure markers such as #ad, #sponsored, "quảng cáo", "đối tác trả phí", "paid partnership", or "in collaboration with"; or an unusually generic/templated bullish promotion for one token combining referral/affiliate links or codes with calls to action such as "join now", "limited time", or "use my code/link". Paid promotions must never count toward convergence.
- Do not over-filter: is_sponsored=false for genuine analysis that merely discloses that the author holds or trades the asset, and for a normal exchange referral link unrelated to the specific market call. Classify sponsorship only when the post is primarily a paid/sponsored token push rather than analysis.
- sponsorship_reason is a concise statement of the disclosure marker or promotional evidence when is_sponsored=true, otherwise null.
- token is the primary asset ticker/symbol, without a leading $, uppercase, or null when no asset is identifiable.
- sentiment is bullish, bearish, or neutral. conviction measures how strongly the author states the thesis (0 to 1), not your extraction confidence.
- timeframe is short (hours/days), medium (weeks/months), long (multiple months/years), or null when it cannot reasonably be inferred.
- price_target is a plain numeric target or null. Do not invent units or targets.
- is_echo=true when the post quotes, retweets, forwards, or clearly repeats another account's call rather than presenting an independently formed thesis. Consider RT/quote markers, attribution such as "as @X said", and copied phrasing.
- echo_of is the attributed handle/channel when identifiable, otherwise null. Do not put a URL in echo_of.
- reasoning_summary is a faithful 1-2 sentence summary of only the thesis stated by the author. Do not add analysis or advice.
- llm_confidence measures your confidence that the extraction is accurate (0 to 1).
- Preserve the supplied post_id exactly.

Required keys: post_id, has_signal, is_sponsored, sponsorship_reason, token, sentiment, conviction, timeframe, price_target, is_echo, echo_of, reasoning_summary, llm_confidence.`;

export function extractionUserPrompt(post: IngestedPost): string {
  return `Extract the signal from this source post:\n${JSON.stringify({
    post_id: post.id,
    author: post.handle,
    channel: post.platform,
    text: post.text,
    timestamp: post.posted_at,
    url: post.url,
    source_is_forward: post.is_forward,
    source_is_quote: post.is_quote,
    source_echo_url: post.echo_of ?? null,
  })}`;
}