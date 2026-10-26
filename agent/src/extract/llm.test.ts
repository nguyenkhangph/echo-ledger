import { describe, expect, test } from "bun:test";

import { RateLimiter, type Fetcher } from "../ingest/http";
import type { IngestedPost } from "../ingest/types";
import { OpenAiCompatibleLlmClient } from "./llm";

const post: IngestedPost = {
  id: "x:alice/status/1",
  kol_id: "alice",
  handle: "@alice",
  platform: "x",
  url: "https://x.com/alice/status/1",
  posted_at: "2026-10-20T10:00:00.000Z",
  text: "$BTC looks ready to break out this week.",
  trust: 0.5,
  is_forward: false,
  is_quote: false,
};

const validContent = JSON.stringify({
  post_id: post.id,
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
  reasoning_summary: "BTC is expected to break out this week.",
  llm_confidence: 0.95,
});

function completion(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

describe("OpenAI-compatible LLM client", () => {
  test("retries once when the model response cannot be parsed", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: Fetcher = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return completion(bodies.length === 1 ? "not json" : validContent);
    };
    const client = new OpenAiCompatibleLlmClient({
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      model: "test-model",
      fetcher,
      limiter: new RateLimiter(0),
      retryDelayMs: 0,
    });

    expect(await client.extract(post)).toMatchObject({ post_id: post.id, token: "BTC" });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
  });

  test("falls back when the endpoint rejects JSON mode", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: Fetcher = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return body.response_format
        ? new Response("response_format is unsupported", { status: 400 })
        : completion(`\`\`\`json\n${validContent}\n\`\`\``);
    };
    const client = new OpenAiCompatibleLlmClient({
      baseUrl: "https://llm.example/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      fetcher,
      limiter: new RateLimiter(0),
    });

    expect((await client.extract(post)).has_signal).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("response_format");
  });
});