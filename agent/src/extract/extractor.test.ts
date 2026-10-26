import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { IngestedPost } from "../ingest/types";
import { applyEchoEvidence, applySponsorshipEvidence, extractPostsToFixtures } from "./extractor";
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
    is_sponsored: false,
    sponsorship_reason: null,
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

    const result = await extractPostsToFixtures([original, unrelated], client, directory, join(directory, "audit"));

    expect(result.signals.map((item) => item.post_id)).toEqual([original.id]);
    expect(result.written).toEqual([join(directory, "2026-10-20.jsonl")]);
    expect((await Bun.file(result.written[0]!).text()).trim().split("\n")).toHaveLength(1);
    expect(result.sponsored).toEqual([]);
    expect(result.auditWritten).toEqual([]);
  });

  test("filters an explicit sponsored post and writes an auditable rejection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const sponsored = post(
      "x:alice/status/6",
      "#ad In collaboration with Example Labs: $MOON is the next breakout. Join now!",
    );
    const client: SignalExtractionClient = { extract: async () => signal(sponsored.id, { token: "MOON" }) };

    const result = await extractPostsToFixtures([sponsored], client, directory, join(directory, "audit"));

    expect(result.signals).toEqual([]);
    expect(result.sponsored[0]).toMatchObject({
      post_id: sponsored.id,
      has_signal: false,
      is_sponsored: true,
    });
    expect(result.sponsored[0]?.sponsorship_reason).toContain("Explicit sponsorship disclosure");
    expect(result.auditWritten).toEqual([join(directory, "audit", "2026-10-20.jsonl")]);
    expect(JSON.parse((await Bun.file(result.auditWritten[0]!).text()).trim())).toMatchObject({
      post_id: sponsored.id,
      is_sponsored: true,
    });
  });

  test("removes a stale actionable fixture when a post is reclassified as sponsored", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const auditDirectory = join(directory, "audit");
    const original = post("x:alice/status/9", "$MOON is breaking out based on rising volume.");
    await extractPostsToFixtures(
      [original],
      { extract: async () => signal(original.id, { token: "MOON" }) },
      directory,
      auditDirectory,
    );
    const sponsored = { ...original, text: "#sponsored $MOON is a bullish gem. Join now and use my link." };

    await extractPostsToFixtures(
      [sponsored],
      { extract: async () => signal(sponsored.id, { token: "MOON" }) },
      directory,
      auditDirectory,
    );

    expect(await Bun.file(join(directory, "2026-10-20.jsonl")).text()).toBe("\n");
    expect(JSON.parse((await Bun.file(join(auditDirectory, "2026-10-20.jsonl")).text()).trim())).toMatchObject({
      post_id: sponsored.id,
      is_sponsored: true,
    });
  });

  test("reuses cached LLM output for unchanged posts and re-extracts edited ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const cacheDirectory = join(directory, "cache");
    const original = post("x:alice/status/11", "$SOL is breaking out on rising volume.");
    let calls = 0;
    const client: SignalExtractionClient = {
      extract: async (input) => {
        calls += 1;
        return signal(input.id, { token: "SOL" });
      },
    };

    const first = await extractPostsToFixtures([original], client, directory, join(directory, "audit"), cacheDirectory);
    const second = await extractPostsToFixtures([original], client, directory, join(directory, "audit"), cacheDirectory);
    expect(calls).toBe(1);
    expect(first.cacheHits).toBe(0);
    expect(second.cacheHits).toBe(1);
    expect(second.signals).toEqual(first.signals);

    const edited = { ...original, text: "$SOL is breaking out on rising volume and fresh ETF inflows." };
    const third = await extractPostsToFixtures([edited], client, directory, join(directory, "audit"), cacheDirectory);
    expect(calls).toBe(2);
    expect(third.cacheHits).toBe(0);
  });

  test("applies the sponsorship guard on top of a cached extraction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const cacheDirectory = join(directory, "cache");
    const promoted = post("x:alice/status/12", "#sponsored $MOON is a bullish gem.");
    const client: SignalExtractionClient = { extract: async (input) => signal(input.id, { token: "MOON" }) };

    await extractPostsToFixtures([promoted], client, directory, join(directory, "audit"), cacheDirectory);
    const cachedRun = await extractPostsToFixtures([promoted], client, directory, join(directory, "audit"), cacheDirectory);

    expect(cachedRun.cacheHits).toBe(1);
    expect(cachedRun.signals).toHaveLength(0);
    expect(cachedRun.sponsored[0]).toMatchObject({ post_id: promoted.id, is_sponsored: true });
  });

  test("keeps completed extractions in the cache when a later LLM call fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-extract-"));
    temporaryDirectories.push(directory);
    const cacheDirectory = join(directory, "cache");
    const good = post("x:alice/status/13", "$ETH looks strong.");
    const bad = post("x:alice/status/14", "$ARB looks strong.");
    const failing: SignalExtractionClient = {
      extract: async (input) => {
        if (input.id === bad.id) throw new Error("LLM timeout");
        return signal(input.id, { token: "ETH" });
      },
    };

    await expect(extractPostsToFixtures([good, bad], failing, directory, join(directory, "audit"), cacheDirectory)).rejects.toThrow("LLM timeout");

    let calls = 0;
    const retry: SignalExtractionClient = {
      extract: async (input) => {
        calls += 1;
        return signal(input.id, { token: "ARB" });
      },
    };
    const result = await extractPostsToFixtures([good, bad], retry, directory, join(directory, "audit"), cacheDirectory);
    expect(calls).toBe(1);
    expect(result.cacheHits).toBe(1);
  });

  test("filters a referral-style token promotion", () => {
    const promoted = post(
      "x:alice/status/7",
      "$MOON is a bullish 100x gem. Limited time—join now and use my code ALICE: https://promo.example/ref",
    );

    expect(applySponsorshipEvidence(promoted, signal(promoted.id, { token: "MOON" }))).toMatchObject({
      has_signal: false,
      is_sponsored: true,
      sponsorship_reason: "Bullish token promotion combines a commercial incentive with a promotional call to action",
    });
  });

  test("keeps genuine analysis with an author position disclosure", () => {
    const analysis = post(
      "x:alice/status/8",
      "I hold and trade $ETH. Weekly fees are rising while exchange supply falls, so my model remains bullish for the next quarter.",
    );

    expect(applySponsorshipEvidence(analysis, signal(analysis.id, { token: "ETH", timeframe: "medium" }))).toMatchObject({
      has_signal: true,
      is_sponsored: false,
      sponsorship_reason: null,
    });
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