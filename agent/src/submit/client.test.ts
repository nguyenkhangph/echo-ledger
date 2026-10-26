import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { approveLongCard } from "../../../shared/src/fixtures";
import { RateLimiter, type Fetcher } from "../ingest/http";
import { CreRecordClient } from "./client";
import { hashFinalizedCard } from "./hash";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("CRE record client", () => {
  test("dry-run writes the payload and never calls fetch when URL is unset", async () => {
    const root = await mkdtemp(join(tmpdir(), "echo-dry-run-"));
    temporaryDirectories.push(root);
    let fetchCalls = 0;
    const client = new CreRecordClient({
      url: null,
      dryRunDirectory: root,
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not run");
      },
      logger: { log: () => undefined },
    });
    const payload = hashFinalizedCard(approveLongCard);

    expect(await client.submit(payload, "2026-10-26")).toBe("dry_run");
    expect(fetchCalls).toBe(0);
    expect(JSON.parse((await Bun.file(join(root, "2026-10-26.jsonl")).text()).trim())).toEqual(payload);
  });

  test("posts the expected payload to a mocked endpoint and reports sent", async () => {
    let requestBody = "";
    const fetcher: Fetcher = async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(null, { status: 202 });
    };
    const client = new CreRecordClient({
      url: "https://cre.example.test/record",
      dryRunDirectory: "unused",
      fetcher,
      limiter: new RateLimiter(0),
      retryDelayMs: 0,
    });
    const payload = hashFinalizedCard(approveLongCard);

    expect(await client.submit(payload, "2026-10-26")).toBe("sent");
    expect(JSON.parse(requestBody)).toEqual(payload);
  });
});