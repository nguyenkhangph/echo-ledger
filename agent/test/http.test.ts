import { describe, expect, test } from "bun:test";

import { fetchTextWithRetry, RateLimiter } from "../src/ingest/http";

describe("ingest HTTP policy", () => {
  test("spaces request starts by the configured interval", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const limiter = new RateLimiter(
      2_000,
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
      () => now,
    );

    await limiter.wait();
    now += 500;
    await limiter.wait();

    expect(waits).toEqual([1_500]);
  });

  test("retries transient responses and routes every attempt through the limiter", async () => {
    let attempts = 0;
    let limiterCalls = 0;
    const limiter = { wait: async () => void (limiterCalls += 1) } as RateLimiter;

    const result = await fetchTextWithRetry("https://example.com", {
      limiter,
      retryDelayMs: 0,
      sleeper: async () => undefined,
      fetcher: async () => {
        attempts += 1;
        return attempts === 1 ? new Response("busy", { status: 503 }) : new Response("ok");
      },
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(limiterCalls).toBe(2);
  });

  test("does not retry permanent client errors", async () => {
    let attempts = 0;
    const limiter = new RateLimiter(0);

    await expect(
      fetchTextWithRetry("https://example.com/missing", {
        limiter,
        fetcher: async () => {
          attempts += 1;
          return new Response("missing", { status: 404 });
        },
      }),
    ).rejects.toThrow("HTTP 404");
    expect(attempts).toBe(1);
  });
});