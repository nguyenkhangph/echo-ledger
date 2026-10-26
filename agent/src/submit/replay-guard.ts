import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import type { ReasoningCard } from "../../../shared/src/card";

import { signalIdentityHash } from "./identity";

const LedgerEntry = z.object({
  card_id: z.string().min(1),
  cardHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  submitted_at: z.string().datetime({ offset: true }),
}).strict();

const SubmissionLedger = z.record(LedgerEntry);
export type LedgerEntry = z.infer<typeof LedgerEntry>;
type SubmissionLedger = z.infer<typeof SubmissionLedger>;

export function dedupKey(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): string {
  return signalIdentityHash(card);
}

export class ReplayGuard {
  constructor(private readonly path: string) {}

  async find(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): Promise<LedgerEntry | undefined> {
    return (await this.read())[dedupKey(card)];
  }

  async record(
    card: ReasoningCard,
    cardHash: `0x${string}`,
    submittedAt = new Date(),
  ): Promise<void> {
    const ledger = await this.read();
    ledger[dedupKey(card)] = LedgerEntry.parse({
      card_id: card.card_id,
      cardHash,
      submitted_at: submittedAt.toISOString(),
    });
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await Bun.write(temporaryPath, `${JSON.stringify(SubmissionLedger.parse(ledger), null, 2)}\n`);
    await rename(temporaryPath, this.path);
  }

  private async read(): Promise<SubmissionLedger> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return {};
    try {
      return SubmissionLedger.parse(await file.json());
    } catch (error) {
      throw new Error(`Invalid submission ledger ${this.path}`, { cause: error });
    }
  }
}