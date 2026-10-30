import { describe, expect, test } from "bun:test";

// The dashboard and the audit tooling re-implement the convergence rule in @echo/shared so they can run in a browser.
// This test keeps the two implementations identical on every combination of up to 5 voices.
import { independentScore, naiveScore } from "../../../shared/src/echo";
import type { GroupedSignal } from "./group";
import { scoreConvergence } from "./score";

const sentiments = ["bullish", "bearish", "neutral"] as const;
const convictions = [0.3, 0.8];

function signal(index: number, sentiment: GroupedSignal["sentiment"], conviction: number, echo: boolean): GroupedSignal {
  return {
    post_id: `p${index}`,
    handle: `@h${index}`,
    sentiment,
    conviction,
    is_echo: echo,
    echo_of: echo ? "@origin" : null,
    reasoning_summary: "x",
    posted_at: "2026-10-20T12:00:00.000Z",
  };
}

describe("shared echo scoring matches the agent", () => {
  test("identical on all small voice sets", () => {
    let cases = 0;
    const options = sentiments.flatMap((s) => convictions.flatMap((c) => [false, true].map((e) => ({ s, c, e }))));
    const build = (size: number, seed: number) => {
      const sources: GroupedSignal[] = [];
      let n = seed;
      for (let i = 0; i < size; i++) {
        const o = options[n % options.length]!;
        n = Math.floor(n / options.length) + i * 7 + 1;
        sources.push(signal(i, o.s, o.c, o.e));
      }
      return sources;
    };
    for (let size = 1; size <= 5; size++) {
      for (let seed = 0; seed < 300; seed++) {
        const sources = build(size, seed * 13 + size);
        const agent = scoreConvergence("btc", sources, 24).convergence;
        const shared = independentScore(sources);
        expect(shared.score).toBe(agent.score);
        expect(shared.passes).toBe(agent.passed);
        expect(shared.voices).toBe(agent.independent_count);
        expect(shared.agreeing).toBe(agent.agreeing_independent_count);
        expect(naiveScore(sources).voices).toBe(sources.length);
        cases += 1;
      }
    }
    expect(cases).toBe(1500);
  });
});
