import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { approveLongCard, rejectNarrativeChasingCard, rejectRiskRuleCard } from "../../../shared/src/fixtures";
import type { CardSubmissionClient } from "./client";
import { runSubmissionPipeline } from "./pipeline";
import { ReplayGuard } from "./replay-guard";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function setup(drafts: readonly unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "echo-submit-"));
  temporaryDirectories.push(root);
  const draftsDirectory = join(root, "drafts");
  await Bun.write(
    join(draftsDirectory, "2026-10-26.jsonl"),
    `${drafts.map((draft) => JSON.stringify(draft)).join("\n")}\n`,
  );
  return {
    root,
    draftsDirectory,
    submittedDirectory: join(root, "submitted"),
    guard: new ReplayGuard(join(root, "submitted-ledger.json")),
  };
}

describe("submission pipeline", () => {
  test("rejects malformed input, records sent success, and continues after a send failure", async () => {
    const malformed = { ...approveLongCard, sources: [{ bad: true }] };
    const fixture = await setup([malformed, approveLongCard, rejectNarrativeChasingCard, rejectRiskRuleCard]);
    const submittedTokens: string[] = [];
    const client: CardSubmissionClient = {
      submit: async (payload) => {
        submittedTokens.push(payload.card.token);
        if (payload.card.token === "ETH") throw new Error("mock CRE unavailable");
        return "sent";
      },
    };
    const errors: string[] = [];

    const result = await runSubmissionPipeline({
      draftsDirectory: fixture.draftsDirectory,
      submittedDirectory: fixture.submittedDirectory,
      date: "2026-10-26",
      client,
      replayGuard: fixture.guard,
      now: () => new Date("2026-10-26T12:00:00.000Z"),
      logger: { log: () => undefined, error: (message) => errors.push(String(message)) },
    });

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["failed", "sent", "failed", "sent"]);
    expect(result.outcomes[0]?.reason).toContain("Draft does not conform to the final ReasoningCard schema");
    expect(result.outcomes[2]?.reason).toBe("mock CRE unavailable");
    expect(submittedTokens).toEqual(["SOL", "ETH", "MICRO"]);
    expect(errors).toHaveLength(2);
    expect((await Bun.file(result.outputPath).text()).trim().split("\n")).toHaveLength(4);
  });

  test("skips a duplicate without calling the client", async () => {
    const fixture = await setup([approveLongCard]);
    await fixture.guard.record(approveLongCard, `0x${"1".repeat(64)}`, new Date("2026-10-25T12:00:00.000Z"));
    let calls = 0;
    const client: CardSubmissionClient = {
      submit: async () => {
        calls += 1;
        return "sent";
      },
    };

    const result = await runSubmissionPipeline({
      draftsDirectory: fixture.draftsDirectory,
      submittedDirectory: fixture.submittedDirectory,
      date: "2026-10-26",
      client,
      replayGuard: fixture.guard,
      logger: { log: () => undefined, error: () => undefined },
    });

    expect(calls).toBe(0);
    expect(result.outcomes[0]).toMatchObject({
      status: "skipped_duplicate",
      card_id: approveLongCard.card_id,
    });
  });

  test("allows one decision per token until its horizon passes, even when the source set grows", async () => {
    const grown = { ...approveLongCard, sources: [...approveLongCard.sources, { ...approveLongCard.sources[0]!, url: "https://x.com/late/status/999", kol: "late-voice" }] };
    const fixture = await setup([approveLongCard, grown]);
    const sent: string[] = [];
    const client: CardSubmissionClient = { submit: async (payload) => { sent.push(payload.card.card_id); return "sent"; } };
    const run = (at: string) => runSubmissionPipeline({
      draftsDirectory: fixture.draftsDirectory,
      submittedDirectory: fixture.submittedDirectory,
      date: "2026-10-26",
      client,
      replayGuard: fixture.guard,
      now: () => new Date(at),
      logger: { log: () => undefined, error: () => undefined },
    });

    const first = await run("2026-10-26T12:00:00.000Z");
    expect(first.outcomes.map((outcome) => outcome.status)).toEqual(["sent", "skipped_duplicate"]);
    expect(first.outcomes[1]?.reason).toContain("one decision per token");
    expect(sent).toHaveLength(1);

    const afterHorizon = new Date(Date.parse("2026-10-26T12:00:00.000Z") + approveLongCard.risk_rules.horizon_h * 3_600_000 + 60_000).toISOString();
    const later = await run(afterHorizon);
    expect(later.outcomes.map((outcome) => outcome.status)).toEqual(["skipped_duplicate", "sent"]);
    expect(sent).toHaveLength(2);
  });

  test("reads the token of legacy ledger entries from their card_id", async () => {
    const fixture = await setup([approveLongCard]);
    await Bun.write(join(fixture.root, "submitted-ledger.json"), JSON.stringify({
      "0xlegacy": { card_id: `card-${approveLongCard.token.toLowerCase()}-approve-123`, cardHash: `0x${"1".repeat(64)}`, submitted_at: "2026-10-26T11:00:00.000Z" },
    }));
    let calls = 0;
    const result = await runSubmissionPipeline({
      draftsDirectory: fixture.draftsDirectory,
      submittedDirectory: fixture.submittedDirectory,
      date: "2026-10-26",
      client: { submit: async () => { calls += 1; return "sent"; } },
      replayGuard: fixture.guard,
      now: () => new Date("2026-10-26T12:00:00.000Z"),
      logger: { log: () => undefined, error: () => undefined },
    });
    expect(calls).toBe(0);
    expect(result.outcomes[0]?.status).toBe("skipped_duplicate");
  });
});
