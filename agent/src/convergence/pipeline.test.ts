import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ExtractedSignal } from "../extract/schema";
import { writePostFixtures } from "../ingest/fixtures";
import type { IngestedPost } from "../ingest/types";
import type { EvidenceClient } from "./evidence";
import { runConvergencePipeline } from "./pipeline";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function post(id: string, handle: string, postedAt: string): IngestedPost {
  return {
    id,
    kol_id: handle,
    handle,
    platform: "x",
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id.split("/").at(-1)}`,
    posted_at: postedAt,
    text: "$BTC higher",
    trust: 0.5,
    is_forward: false,
    is_quote: false,
  };
}

function signal(postId: string): ExtractedSignal {
  return {
    post_id: postId,
    has_signal: true,
    token: "BTC",
    sentiment: "bullish",
    conviction: 0.8,
    timeframe: "short",
    price_target: null,
    is_echo: false,
    echo_of: null,
    reasoning_summary: "BTC is expected to move higher.",
    llm_confidence: 0.9,
  };
}

describe("convergence pipeline", () => {
  test("loads a cross-day window and survives evidence fetch failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "echo-convergence-"));
    temporaryDirectories.push(root);
    const postsDirectory = join(root, "posts");
    const extractedDirectory = join(root, "extracted");
    const candidatesDirectory = join(root, "candidates");
    const first = post("x:alice/status/1", "@alice", "2026-10-19T23:30:00.000Z");
    const second = post("x:bob/status/2", "@bob", "2026-10-20T01:00:00.000Z");
    await writePostFixtures(postsDirectory, [first, second]);
    await Bun.write(join(extractedDirectory, "2026-10-19.jsonl"), `${JSON.stringify(signal(first.id))}\n`);
    await Bun.write(join(extractedDirectory, "2026-10-20.jsonl"), `${JSON.stringify(signal(second.id))}\n`);
    const evidenceClient: EvidenceClient = {
      fetch: async () => { throw new Error("CoinGecko unavailable"); },
    };

    const result = await runConvergencePipeline({
      extractedDirectory,
      postsDirectory,
      candidatesDirectory,
      outputDate: "2026-10-20",
      windowEnd: new Date("2026-10-20T02:00:00.000Z"),
      windowHours: 3,
      evidenceClient,
    });

    expect(result).toMatchObject({ passed: 1, notPassed: 0 });
    expect(result.candidates[0]).toMatchObject({
      token: "BTC",
      evidence: null,
      convergence: { independent_count: 2, passed: true },
    });
    expect(result.candidates[0]?.sources.map((item) => item.handle)).toEqual(["@alice", "@bob"]);
    expect((await Bun.file(result.outputPath).text()).trim().split("\n")).toHaveLength(1);
  });
});