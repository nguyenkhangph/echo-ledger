import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { approveLongCard } from "../../../shared/src/fixtures";
import { cardHash } from "../../../shared/src/hash";
import { ReplayGuard, dedupKey } from "./replay-guard";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("submission replay guard", () => {
  test("matches the same signal despite a different card ID and timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "echo-replay-"));
    temporaryDirectories.push(root);
    const guard = new ReplayGuard(join(root, "submitted-ledger.json"));
    await guard.record(approveLongCard, cardHash(approveLongCard), new Date("2026-10-26T10:00:00.000Z"));
    const reprocessed = {
      ...approveLongCard,
      card_id: "card-sol-approve-999",
      created_at: "2026-10-27T10:00:00.000Z",
    };

    expect(dedupKey(reprocessed)).toBe(dedupKey(approveLongCard));
    expect(await guard.find(reprocessed)).toMatchObject({
      card_id: approveLongCard.card_id,
      submitted_at: "2026-10-26T10:00:00.000Z",
    });
  });
});