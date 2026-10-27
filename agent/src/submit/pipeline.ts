import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { ReasoningCard } from "../../../shared/src/card";

import type { CardSubmissionClient } from "./client";
import { finalizeCard } from "./finalize";
import { hashFinalizedCard } from "./hash";
import { ReplayGuard } from "./replay-guard";

export const SubmissionOutcome = z.object({
  input_index: z.number().int().nonnegative(),
  token: z.string().min(1).nullable(),
  card_id: z.string().min(1).nullable(),
  cardHash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
  status: z.enum(["sent", "dry_run", "skipped_duplicate", "failed"]),
  reason: z.string().min(1),
}).strict();

export type SubmissionOutcome = z.infer<typeof SubmissionOutcome>;

export interface SubmissionPipelineOptions {
  draftsDirectory: string;
  submittedDirectory: string;
  date: string;
  client: CardSubmissionClient;
  replayGuard: ReplayGuard;
  now?: () => Date;
  logger?: Pick<Console, "log" | "error">;
}

export interface SubmissionPipelineResult {
  outcomes: SubmissionOutcome[];
  outputPath: string;
}

async function readDraftValues(path: string): Promise<unknown[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { __invalid_json: `Invalid draft JSON ${path}:${index + 1}`, __cause: String(error) };
      }
    });
}

function hint(value: unknown, key: "token" | "card_id"): string | null {
  if (value !== null && typeof value === "object") {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

export async function runSubmissionPipeline({
  draftsDirectory,
  submittedDirectory,
  date,
  client,
  replayGuard,
  now = () => new Date(),
  logger = console,
}: SubmissionPipelineOptions): Promise<SubmissionPipelineResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid submission date: ${date}`);
  const drafts = await readDraftValues(join(draftsDirectory, `${date}.jsonl`));
  const outcomes: SubmissionOutcome[] = [];

  for (const [inputIndex, rawDraft] of drafts.entries()) {
    try {
      // Validate enough to derive the signal identity before assigning a new ID/timestamp.
      let draft;
      try {
        draft = ReasoningCard.parse(rawDraft);
      } catch (error) {
        throw new Error("Draft does not conform to the final ReasoningCard schema", { cause: error });
      }
      const duplicate = await replayGuard.find(draft);
      if (duplicate) {
        const reason = `Underlying signal already submitted as ${duplicate.card_id} at ${duplicate.submitted_at}`;
        logger.log(`Skipping duplicate ${draft.token}: ${reason}`);
        outcomes.push(SubmissionOutcome.parse({
          input_index: inputIndex,
          token: draft.token,
          card_id: duplicate.card_id,
          cardHash: duplicate.cardHash,
          status: "skipped_duplicate",
          reason,
        }));
        continue;
      }

      const active = await replayGuard.findActiveTokenDecision(draft.token, now(), draft.risk_rules.horizon_h);
      if (active) {
        const reason = `${draft.token.toUpperCase()} already decided as ${active.card_id} at ${active.submitted_at}; one decision per token until its ${active.horizon_h ?? draft.risk_rules.horizon_h} h horizon passes`;
        logger.log(`Skipping ${draft.token}: ${reason}`);
        outcomes.push(SubmissionOutcome.parse({
          input_index: inputIndex,
          token: draft.token,
          card_id: active.card_id,
          cardHash: active.cardHash,
          status: "skipped_duplicate",
          reason,
        }));
        continue;
      }

      const payload = hashFinalizedCard(finalizeCard(draft, now()));
      const status = await client.submit(payload, date);
      if (status === "sent") await replayGuard.record(payload.card, payload.cardHash, now());
      outcomes.push(SubmissionOutcome.parse({
        input_index: inputIndex,
        token: payload.card.token,
        card_id: payload.card.card_id,
        cardHash: payload.cardHash,
        status,
        reason: status === "sent" ? "CRE record endpoint accepted the request" : "CRE_RECORD_URL unset; payload saved locally only",
      }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Submission failed for draft ${inputIndex}: ${reason}`);
      outcomes.push(SubmissionOutcome.parse({
        input_index: inputIndex,
        token: hint(rawDraft, "token"),
        card_id: hint(rawDraft, "card_id"),
        cardHash: null,
        status: "failed",
        reason,
      }));
    }
  }

  await mkdir(submittedDirectory, { recursive: true });
  const outputPath = join(submittedDirectory, `${date}.jsonl`);
  const temporaryPath = `${outputPath}.tmp`;
  await Bun.write(temporaryPath, outcomes.length === 0
    ? ""
    : `${outcomes.map((outcome) => JSON.stringify(outcome)).join("\n")}\n`);
  await rename(temporaryPath, outputPath);
  return { outcomes, outputPath };
}