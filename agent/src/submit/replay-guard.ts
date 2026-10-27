import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import type { ReasoningCard } from "../../../shared/src/card";

import { signalIdentityHash } from "./identity";

const LedgerEntry = z.object({
  card_id: z.string().min(1),
  cardHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  submitted_at: z.string().datetime({ offset: true }),
  // Added later; older entries carry the token only inside card_id ("card-<token>-<verdict>-NNN").
  token: z.string().min(1).optional(),
  horizon_h: z.number().positive().optional(),
}).strict();

const SubmissionLedger = z.record(LedgerEntry);
export type LedgerEntry = z.infer<typeof LedgerEntry>;
type SubmissionLedger = z.infer<typeof SubmissionLedger>;

export function dedupKey(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): string {
  return signalIdentityHash(card);
}

function entryToken(entry: LedgerEntry): string | null {
  return entry.token?.toUpperCase() ?? entry.card_id.match(/^card-([a-z0-9]+)-/i)?.[1]?.toUpperCase() ?? null;
}

export class ReplayGuard {
  constructor(private readonly path: string) {}

  async find(card: Pick<ReasoningCard, "token" | "window_h" | "sources">): Promise<LedgerEntry | undefined> {
    return (await this.read())[dedupKey(card)];
  }

  /**
   * The latest decision on this token whose horizon has not yet elapsed. A narrative that keeps
   * gaining posts changes its source set (and so its signal identity), but it is still the same
   * call: one decision per token per horizon.
   */
  async findActiveTokenDecision(token: string, now: Date, fallbackHorizonH: number): Promise<LedgerEntry | undefined> {
    const wanted = token.toUpperCase();
    return Object.values(await this.read())
      .filter((entry) => entryToken(entry) === wanted)
      .filter((entry) => now.getTime() - Date.parse(entry.submitted_at) < (entry.horizon_h ?? fallbackHorizonH) * 3_600_000)
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
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
      token: card.token.toUpperCase(),
      horizon_h: card.risk_rules.horizon_h,
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