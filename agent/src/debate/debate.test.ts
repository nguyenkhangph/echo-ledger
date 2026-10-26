import { describe, expect, test } from "bun:test";

import type { ConvergenceCandidate } from "../convergence/schema";
import type { ChatMessage, StructuredCompletionClient } from "../extract/llm";
import type { DebatePromptContext } from "./prompts";
import { runDebate } from "./debate";

const candidate: ConvergenceCandidate = {
  token: "SOL",
  window_h: 24,
  sources: [
    { post_id: "x:alice/1", handle: "@alice", sentiment: "bullish", conviction: 0.8, is_echo: false, echo_of: null, reasoning_summary: "SOL activity is rising." },
    { post_id: "x:bob/2", handle: "@bob", sentiment: "bearish", conviction: 0.6, is_echo: false, echo_of: null, reasoning_summary: "SOL faces resistance." },
  ],
  convergence: {
    independent_count: 2,
    echo_count: 0,
    agreeing_independent_count: 1,
    score: 0.5,
    threshold: 0.6,
    passed: false,
  },
  evidence: { price: 180, change_24h_pct: 8, market_cap: 80_000_000_000, fetched_at: "2026-10-20T12:00:00.000Z", source: "CoinGecko" },
};

const context: DebatePromptContext = {
  candidate,
  sources: [
    { ...candidate.sources[0]!, timeframe: "short" },
    { ...candidate.sources[1]!, timeframe: "long" },
  ],
};

function stage(messages: readonly ChatMessage[]): "bull" | "bear" | "judge" {
  const prompt = messages[0]?.content ?? "";
  if (prompt.includes("Argue FOR")) return "bull";
  if (prompt.includes("Argue AGAINST")) return "bear";
  return "judge";
}

describe("Bull/Bear/Judge debate", () => {
  test("passes Bull and Bear outputs into Judge and preserves a mocked no_action decision", async () => {
    let judgePrompt = "";
    const client: StructuredCompletionClient = {
      model: "mock-judge",
      completeJson: async (messages) => {
        const current = stage(messages);
        if (current === "bull") return JSON.stringify({ argument: "@alice supports a tactical long." });
        if (current === "bear") return JSON.stringify({ argument: "@bob conflicts and the timeframes differ." });
        judgePrompt = messages.at(-1)?.content ?? "";
        return JSON.stringify({
          action: "no_action",
          suggested_size_pct: 0,
          verdict: "Bear is more convincing because the two independent sources conflict across timeframes.",
          confidence: 0.84,
          advisory_risk_rules: {
            lead_min_ok: "UNKNOWN",
            price_deviation_ok: "UNKNOWN",
            min_mcap_ok: "PASS",
            max_position_pct_ok: "PASS",
            max_open_ok: "unknown_requires_onchain_read",
          },
        });
      },
    };

    const result = await runDebate(context, client);

    expect(result.judge).toMatchObject({ action: "no_action", suggested_size_pct: 0 });
    expect(judgePrompt).toContain("@alice supports a tactical long.");
    expect(judgePrompt).toContain("@bob conflicts and the timeframes differ.");
    expect(judgePrompt).toContain('"timeframe":"short"');
    expect(judgePrompt).toContain('"timeframe":"long"');
  });

  test("retries a stage once after schema-invalid output", async () => {
    let bullCalls = 0;
    const client: StructuredCompletionClient = {
      model: "mock-judge",
      completeJson: async (messages) => {
        const current = stage(messages);
        if (current === "bull") {
          bullCalls += 1;
          return bullCalls === 1 ? JSON.stringify({ wrong: true }) : JSON.stringify({ argument: "Valid bull retry." });
        }
        if (current === "bear") return JSON.stringify({ argument: "Valid bear." });
        return JSON.stringify({
          action: "open_long",
          suggested_size_pct: 0.03,
          verdict: "Bull is more convincing after review.",
          confidence: 0.75,
          advisory_risk_rules: {
            lead_min_ok: "UNKNOWN",
            price_deviation_ok: "UNKNOWN",
            min_mcap_ok: "PASS",
            max_position_pct_ok: "PASS",
            max_open_ok: "unknown_requires_onchain_read",
          },
        });
      },
    };

    expect((await runDebate(context, client)).bull.argument).toBe("Valid bull retry.");
    expect(bullCalls).toBe(2);
  });
});