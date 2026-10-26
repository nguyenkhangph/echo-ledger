import { describe, expect, test } from "bun:test";

import { ExtractedSignal } from "./schema";

const validSignal = {
  post_id: "x:alice/status/1",
  has_signal: true,
  is_sponsored: false,
  sponsorship_reason: null,
  token: "$btc",
  sentiment: "bullish",
  conviction: 0.8,
  timeframe: "medium",
  price_target: 125_000,
  is_echo: false,
  echo_of: null,
  reasoning_summary: "BTC is expected to rise as liquidity improves.",
  llm_confidence: 0.9,
};

describe("ExtractedSignal schema", () => {
  test("validates and normalizes a complete signal", () => {
    expect(ExtractedSignal.parse(validSignal).token).toBe("BTC");
  });

  test("rejects out-of-range values and unknown fields", () => {
    expect(() => ExtractedSignal.parse({ ...validSignal, conviction: 1.1 })).toThrow();
    expect(() => ExtractedSignal.parse({ ...validSignal, llm_confidence: -0.1 })).toThrow();
    expect(() => ExtractedSignal.parse({ ...validSignal, untrusted: true })).toThrow();
  });

  test("enforces an auditable sponsorship classification", () => {
    expect(() => ExtractedSignal.parse({
      ...validSignal,
      is_sponsored: true,
      sponsorship_reason: "Explicit #ad disclosure",
    })).toThrow("Sponsored posts cannot be actionable signals");
    expect(ExtractedSignal.parse({
      ...validSignal,
      has_signal: false,
      is_sponsored: true,
      sponsorship_reason: "Explicit #ad disclosure",
    })).toMatchObject({ has_signal: false, is_sponsored: true });
  });

  test("defaults sponsorship fields for existing fixtures", () => {
    const { is_sponsored: _isSponsored, sponsorship_reason: _reason, ...legacySignal } = validSignal;
    expect(ExtractedSignal.parse(legacySignal)).toMatchObject({
      is_sponsored: false,
      sponsorship_reason: null,
    });
  });
});