import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { Fetcher, Sleeper } from "../ingest/http";
import { RateLimiter } from "../ingest/http";
import type { HashedCard } from "./hash";

const sleep: Sleeper = (milliseconds) => Bun.sleep(milliseconds);

export type SubmissionMode = "sent" | "dry_run";

export interface CardSubmissionClient {
  submit(payload: HashedCard, date: string): Promise<SubmissionMode>;
}

export interface CreRecordClientOptions {
  url?: string | null;
  dryRunDirectory: string;
  fetcher?: Fetcher;
  limiter?: RateLimiter;
  attempts?: number;
  retryDelayMs?: number;
  sleeper?: Sleeper;
  logger?: Pick<Console, "log">;
}

class NonRetryableSubmissionError extends Error {}

export class CreRecordClient implements CardSubmissionClient {
  private readonly url: string | null;
  private readonly fetcher: Fetcher;
  private readonly limiter: RateLimiter;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly sleeper: Sleeper;
  private readonly logger: Pick<Console, "log">;

  constructor(private readonly options: CreRecordClientOptions) {
    const configuredUrl = options.url === undefined ? process.env.CRE_RECORD_URL : options.url;
    this.url = configuredUrl?.trim() || null;
    this.fetcher = options.fetcher ?? fetch;
    this.limiter = options.limiter ?? new RateLimiter();
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleeper = options.sleeper ?? sleep;
    this.logger = options.logger ?? console;
  }

  async submit(payload: HashedCard, date: string): Promise<SubmissionMode> {
    if (!this.url) {
      const path = `${this.options.dryRunDirectory}/${date}.jsonl`;
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
      this.logger.log(`CRE_RECORD_URL is unset; dry-run submission written to ${path}`);
      return "dry_run";
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        await this.limiter.wait();
        const response = await this.fetcher(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return "sent";
        const detail = (await response.text()).trim();
        const error = new Error(`CRE record HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          throw new NonRetryableSubmissionError(error.message);
        }
        lastError = error;
      } catch (error) {
        if (error instanceof NonRetryableSubmissionError) throw error;
        lastError = error;
      }
      if (attempt < this.attempts) await this.sleeper(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error("CRE record request failed");
  }
}