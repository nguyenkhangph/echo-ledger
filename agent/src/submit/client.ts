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
  timeoutMs?: number;
}

/**
 * The CRE simulator's local HTTP trigger server (`cre workflow simulate record --listen`) accepts
 * POST /trigger with the workflow input wrapped as {"input": ...}. A bare host such as
 * http://localhost:2000 is completed to that path.
 */
export function triggerUrl(configured: string): string {
  const url = new URL(configured);
  if (url.pathname === "" || url.pathname === "/") url.pathname = "/trigger";
  return url.toString();
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
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
  private readonly timeoutMs: number;

  constructor(private readonly options: CreRecordClientOptions) {
    const configuredUrl = options.url === undefined ? process.env.CRE_RECORD_URL : options.url;
    this.url = configuredUrl?.trim() ? triggerUrl(configuredUrl.trim()) : null;
    this.fetcher = options.fetcher ?? fetch;
    this.limiter = options.limiter ?? new RateLimiter();
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleeper = options.sleeper ?? sleep;
    this.logger = options.logger ?? console;
    // A broadcast execution fetches prices, reads the chain and waits for the write before replying.
    this.timeoutMs = options.timeoutMs ?? 120_000;
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
          body: JSON.stringify({ input: payload }),
          signal: AbortSignal.timeout(this.timeoutMs),
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
        // The listener may already be executing (and broadcasting) this card; retrying now could send it twice.
        if (isTimeout(error)) throw new Error(`CRE record request timed out after ${this.timeoutMs} ms; not retried this cycle`);
        lastError = error;
      }
      if (attempt < this.attempts) await this.sleeper(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error("CRE record request failed");
  }
}