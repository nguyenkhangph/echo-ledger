import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { IngestedPost } from "../ingest/types";
import { applyEchoEvidence, extractPostsToFixtures } from "./extractor";
import type { SignalExtractionClient } from "./llm";
import type { ExtractedSignal } from "./schema";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function post(id: string, text: string, overrides: Partial<IngestedPost> = {}): IngestedPost {
  return {
    id,
    kol_id: "alice",
    handle: "@alice",
    platform: "x",
    url: `https://x.com/alice/status/${id.split("/").at(-1)}`,
    posted_at: "2026-10-20T10:00:00.000Z",
    text,
    trust: 0.5,
    is_forward: false,
    is_quote: false,
    ...overrides,
  };
}

function signal(postId: string, overrides: Partial<ExtractedSignal> = {}): ExtractedSignal {
  return {
    post_id: postId,
    has_signal: true,
    token: "BTC",
    sentiment: "bullish",
    conviction: 0.7,
    timeframe: "short",
    price_target: null,
    is_echo: false,
    echo_of: null,
    reasoning_summary: "BTC is expected to move higher.",
    llm_confidence: 0.9,
    ...overrides,
  };
}

describe("post extraction", () => {
  test("drops posts without actionable crypto content and writes only signals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const original = post("x:alice/status/1", "$BTC should break out this week.");
    const unrelated = post("x:alice/status/2", "Great coffee and weather today.");
    const client: SignalExtractionClient = {
      extract: async (input) => input.id === unrelated.id
        ? signal(input.id, {
            has_signal: false,
            token: null,
            sentiment: "neutral",
            conviction: 0,
            timeframe: null,
            reasoning_summary: "The post contains no crypto thesis.",
          })
        : signal(input.id),
    };

    const result = await extractPostsToFixtures([original, unrelated], client, directory);

    expect(result.signals.map((item) => item.post_id)).toEqual([original.id]);
    expect(result.written).toEqual([join(directory, "2026-10-20.jsonl")]);
    expect((await Bun.file(result.written[0]!).text()).trim().split("\n")).toHaveLength(1);
  });

  test("distinguishes an original call from an obvious RT", () => {
    const original = post("x:alice/status/3", "$ETH is undervalued based on my fee model.");
    const retweet = post("x:alice/status/4", "RT @bob: $ETH is going to 5000.");

    expect(applyEchoEvidence(original, signal(original.id, { token: "ETH" }))).toMatchObject({
      is_echo: false,
      echo_of: null,
    });
    expect(applyEchoEvidence(retweet, signal(retweet.id, { token: "ETH" }))).toMatchObject({
      is_echo: true,
      echo_of: "@bob",
    });
  });

  test("uses source quote metadata even if the mocked model misses it", () => {
    const quote = post("x:alice/status/5", "$SOL higher, as discussed here.", {
      is_quote: true,
      echo_of: "https://x.com/carol/status/10",
    });

    expect(applyEchoEvidence(quote, signal(quote.id, { token: "SOL" }))).toMatchObject({
      is_echo: true,
      echo_of: "@carol",
    });
  });
});