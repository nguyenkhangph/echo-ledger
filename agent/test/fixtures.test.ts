import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { replayPostFixtures, writePostFixtures } from "../src/ingest/fixtures";
import type { IngestedPost } from "../src/ingest/types";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const post: IngestedPost = {
  id: "x:alice/status/1",
  kol_id: "alice",
  handle: "@alice",
  platform: "x",
  url: "https://x.com/alice/status/1",
  posted_at: "2026-10-20T10:00:00.000Z",
  text: "A manually captured post",
  trust: 0.5,
  is_forward: false,
  is_quote: false,
};

describe("post fixtures", () => {
  test("writes date-grouped JSONL idempotently and replays it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echo-ingest-"));
    temporaryDirectories.push(directory);

    await writePostFixtures(directory, [post]);
    await writePostFixtures(directory, [post]);

    expect(await replayPostFixtures(directory)).toEqual([post]);
    expect(await replayPostFixtures(directory, "2026-10-20")).toEqual([post]);
    expect((await Bun.file(join(directory, "2026-10-20.jsonl")).text()).trim().split("\n")).toHaveLength(1);
  });
});