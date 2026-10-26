import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ReasoningCard } from "../../../shared/src/card";

import type { ConvergenceCandidate } from "../convergence/schema";
import type { ExtractedSignal } from "../extract/schema";
import type { ChatMessage, StructuredCompletionClient } from "../extract/llm";
import { writePostFixtures } from "../ingest/fixtures";
import type { IngestedPost } from "../ingest/types";
import { runDebatePipeline } from "./pipeline";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function post(token: string, author: string, id: number): IngestedPost {
  return {
    id: `x:${author}/status/${id}`,
    kol_id: author,
    handle: `@${author}`,
    platform: "x",
    url: `https://x.com/${author}/status/${id}`,
    posted_at: `2026-10-20T1${id}:00:00.000Z`,
    text: `$${token} has a strong setup according to ${author}.`,
    trust: 0.5,
    is_forward: false,
    is_quote: false,
  };
}

function signal(source: IngestedPost, token: string): ExtractedSignal {
  return {
    post_id: source.id,
    has_signal: true,
    token,
    sentiment: "bullish",
    conviction: 0.85,
    timeframe: "short",
    price_target: null,
    is_echo: false,
    echo_of: null,
    reasoning_summary: `${token} has a strong setup.`,
    llm_confidence: 0.9,
  };
}

function candidate(token: string, posts: readonly IngestedPost[], passed = true): ConvergenceCandidate {
  return {
    token,
    window_h: 24,
    sources: posts.map((source) => ({
      post_id: source.id,
      handle: source.handle,
      sentiment: "bullish",
      conviction: 0.85,
      is_echo: false,
      echo_of: null,
      reasoning_summary: `${token} has a strong setup.`,
    })),
    convergence: {
      independent_count: posts.length,
      echo_count: 0,
      agreeing_independent_count: posts.length,
      score: 1,
      threshold: 0.6,
      passed,
    },
    evidence: {
      price: 100,
      change_24h_pct: 1.2,
      market_cap: 20_000_000_000,
      fetched_at: "2026-10-20T12:00:00.000Z",
      source: "CoinGecko",
    },
  };
}

function stage(messages: readonly ChatMessage[]): "bull" | "bear" | "judge" {
  const system = messages[0]?.content ?? "";
  return system.includes("Argue FOR") ? "bull" : system.includes("Argue AGAINST") ? "bear" : "judge";
}

describe("debate pipeline", () => {
  test("writes a shared-schema draft and skips a candidate whose retry still fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "echo-debate-"));
    temporaryDirectories.push(root);
    const postsDirectory = join(root, "posts");
    const extractedDirectory = join(root, "extracted");
    const candidatesDirectory = join(root, "candidates");
    const draftsDirectory = join(root, "drafts");
    const btcPosts = [post("BTC", "alice", 1), post("BTC", "bob", 2)];
    const ethPosts = [post("ETH", "carol", 3), post("ETH", "dave", 4)];
    const ignoredPosts = [post("SOL", "eve", 5), post("SOL", "frank", 6)];
    const posts = [...btcPosts, ...ethPosts, ...ignoredPosts];
    await writePostFixtures(postsDirectory, posts);
    await Bun.write(
      join(extractedDirectory, "2026-10-20.jsonl"),
      `${posts.map((source) => JSON.stringify(signal(source, source.text.slice(1, 4)))).join("\n")}\n`,
    );
    await Bun.write(
      join(candidatesDirectory, "2026-10-20.jsonl"),
      `${[
        candidate("BTC", btcPosts),
        candidate("ETH", ethPosts),
        candidate("SOL", ignoredPosts, false),
      ].map((item) => JSON.stringify(item)).join("\n")}\n`,
    );
    const errors: string[] = [];
    const client: StructuredCompletionClient = {
      model: "mock/debate-model",
      completeJson: async (messages) => {
        const body = messages.map((message) => message.content).join("\n");
        if (body.includes('"token":"ETH"')) return "still invalid";
        const current = stage(messages);
        if (current === "bull") return JSON.stringify({ argument: "@alice and @bob independently support BTC with 0.85 conviction." });
        if (current === "bear") return JSON.stringify({ argument: "The evidence is only a snapshot and the source count is two." });
        return JSON.stringify({
          action: "open_long",
          suggested_size_pct: 0.03,
          verdict: "Bull is more convincing because two independent sources agree and the move is not extended.",
          confidence: 0.82,
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

    const result = await runDebatePipeline({
      candidatesDirectory,
      extractedDirectory,
      postsDirectory,
      draftsDirectory,
      date: "2026-10-20",
      client,
      now: () => new Date("2026-10-20T15:00:00.000Z"),
      logger: { error: (message) => errors.push(String(message)) },
    });

    expect(result).toMatchObject({ attempted: 2, skipped: 1 });
    expect(result.drafts).toHaveLength(1);
    expect(ReasoningCard.parse(result.drafts[0])).toMatchObject({
      card_id: expect.stringContaining("draft-btc-"),
      token: "BTC",
      debate: { verdict: "APPROVE", confidence: 0.82 },
      decision: { side: "long", size_pct: 0.03 },
      models: { extract_model: "unknown", judge_model: "mock/debate-model" },
    });
    expect(result.drafts[0]?.sources.map((source) => source.kol)).toEqual(["@alice", "@bob"]);
    expect(errors).toEqual([expect.stringContaining("Skipping debate candidate ETH")]);
    expect((await Bun.file(result.outputPath).text()).trim().split("\n")).toHaveLength(1);
  });
});