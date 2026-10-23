export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Sleeper = (milliseconds: number) => Promise<void>;

const sleep: Sleeper = (milliseconds) => Bun.sleep(milliseconds);

export class RateLimiter {
  private lastRequestStartedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly intervalMs = 2_000,
    private readonly sleeper: Sleeper = sleep,
    private readonly now: () => number = Date.now,
  ) {}

  async wait(): Promise<void> {
    const waitMs = Math.max(0, this.lastRequestStartedAt + this.intervalMs - this.now());
    if (waitMs > 0) await this.sleeper(waitMs);
    this.lastRequestStartedAt = this.now();
  }
}

export interface FetchWithRetryOptions {
  fetcher?: Fetcher;
  limiter: RateLimiter;
  attempts?: number;
  retryDelayMs?: number;
  sleeper?: Sleeper;
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

class NonRetryableHttpError extends Error {}

export async function fetchTextWithRetry(
  url: string,
  {
    fetcher = fetch,
    limiter,
    attempts = 3,
    retryDelayMs = 2_000,
    sleeper = sleep,
  }: FetchWithRetryOptions,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await limiter.wait();
      const response = await fetcher(url, {
        headers: { "user-agent": "EchoLedger/0.1 (practice research ingestion)" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return await response.text();

      const error = new Error(`HTTP ${response.status} fetching ${url}`);
      if (!isRetryable(response.status)) {
        throw new NonRetryableHttpError(error.message);
      }
      lastError = error;
    } catch (error) {
      if (error instanceof NonRetryableHttpError) throw error;
      lastError = error;
    }

    if (attempt < attempts) await sleeper(retryDelayMs * 2 ** (attempt - 1));
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}