import { describe, expect, test } from "bun:test";
import { echoFlippedVerdict, independentScore, naiveScore, pivotalVoices, trustWeightedScore, type VoteSource } from "../src/echo";

const v = (handle: string, sentiment: VoteSource["sentiment"], is_echo = false, conviction = 0.5): VoteSource => ({ handle, sentiment, conviction, is_echo });

describe("echo scoring", () => {
  // BTC, 26 Oct on the live run: glassnode bearish, two bullish voices, one of them only repeating.
  const live = [v("glassnode", "bearish"), v("cryptoquant_official", "bullish"), v("thedailyhodl", "bullish", true)];

  test("the agent discards the echo and stays below the bar", () => {
    const r = independentScore(live);
    expect(r.voices).toBe(2);
    expect(r.score).toBe(0.5);
    expect(r.passes).toBe(false);
  });

  test("a naive counter would have opened it", () => {
    const r = naiveScore(live);
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.passes).toBe(true);
    expect(echoFlippedVerdict(live)).toBe(true);
  });

  test("no echo, no difference", () => {
    const clean = [v("a", "bullish"), v("b", "bullish"), v("c", "bearish")];
    expect(independentScore(clean)).toEqual(naiveScore(clean));
    expect(echoFlippedVerdict(clean)).toBe(false);
  });

  test("needs two independent voices", () => {
    expect(independentScore([v("a", "bullish"), v("b", "bullish", true)]).passes).toBe(false);
  });

  test("trust-weighted shadow score moves with recorded trust", () => {
    const voices = [v("high", "bullish"), v("low", "bullish"), v("dissent", "bearish")];
    const equal = trustWeightedScore(voices, () => 0.5);
    expect(equal).toBeCloseTo(2 / 3);
    const weighted = trustWeightedScore(voices, (h) => (h === "dissent" ? 0.9 : 0.3));
    expect(weighted).toBeLessThan(equal);
    expect(trustWeightedScore([], () => 0.5)).toBe(0);
  });

  test("pivotal voices: who alone decides the verdict", () => {
    // 2 bullish of 3 independent passes (0.67); dropping either bullish voice leaves 1 of 2 = 0.50, which fails.
    const voices = [v("a", "bullish"), v("b", "bullish"), v("c", "bearish"), v("d", "bullish", true)];
    expect(pivotalVoices(voices)).toEqual(["a", "b"]);
    // An echo never matters, and a strong majority has no single pivotal voice.
    expect(pivotalVoices([v("a", "bullish"), v("b", "bullish"), v("c", "bullish"), v("d", "bullish")])).toEqual([]);
  });
});
