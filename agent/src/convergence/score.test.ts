import { describe, expect, test } from "bun:test";

import type { GroupedSignal } from "./group";
import { dominantSentiment, scoreConvergence } from "./score";

function source(
  postId: string,
  sentiment: GroupedSignal["sentiment"],
  conviction: number,
  isEcho = false,
): GroupedSignal {
  return {
    post_id: postId,
    handle: `@${postId}`,
    sentiment,
    conviction,
    is_echo: isEcho,
    echo_of: isEcho ? "@origin" : null,
    reasoning_summary: `${sentiment} thesis`,
    posted_at: "2026-10-20T12:00:00.000Z",
  };
}

describe("convergence scoring", () => {
  test("passes a clear independent majority", () => {
    const candidate = scoreConvergence("btc", [
      source("one", "bullish", 0.8),
      source("two", "bullish", 0.7),
      source("three", "bearish", 0.9),
    ], 24);

    expect(candidate.token).toBe("BTC");
    expect(candidate.convergence).toEqual({
      independent_count: 3,
      echo_count: 0,
      agreeing_independent_count: 2,
      score: 2 / 3,
      threshold: 0.6,
      passed: true,
    });
  });

  test("five echoes cannot turn one independent call into convergence", () => {
    const candidate = scoreConvergence("ETH", [
      source("origin", "bullish", 0.9),
      ...Array.from({ length: 5 }, (_, index) => source(`echo-${index}`, "bullish", 0.9, true)),
    ], 24);

    expect(candidate.sources).toHaveLength(6);
    expect(candidate.convergence).toMatchObject({
      independent_count: 1,
      echo_count: 5,
      agreeing_independent_count: 1,
      score: 1,
      passed: false,
    });
  });

  test("uses total conviction to break an equal independent count", () => {
    const independent = [
      source("bull-one", "bullish", 0.9),
      source("bull-two", "bullish", 0.8),
      source("bear-one", "bearish", 0.4),
      source("bear-two", "bearish", 0.3),
    ];

    expect(dominantSentiment(independent)).toBe("bullish");
    expect(scoreConvergence("SOL", independent, 24).convergence).toMatchObject({
      agreeing_independent_count: 2,
      score: 0.5,
      passed: false,
    });
  });

  test("uses bullish, bearish, neutral order if count and conviction both tie", () => {
    expect(dominantSentiment([
      source("bull", "bullish", 0.5),
      source("bear", "bearish", 0.5),
    ])).toBe("bullish");
  });
});