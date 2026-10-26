import { z } from "zod";

import { RateLimiter, type Fetcher, type Sleeper } from "../ingest/http";
import { MarketEvidence, type MarketEvidence as MarketEvidenceType } from "./schema";

// TODO: Extend this map as the monitored token universe grows or replace it with a reviewed asset registry.
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  LINK: "chainlink",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  USDC: "usd-coin",
  USDT: "tether",
};

const CoinGeckoResponse = z.record(
  z.object({
    usd: z.number().finite().nonnegative(),
    usd_24h_change: z.number().finite(),
    usd_market_cap: z.number().finite().nonnegative().nullish(),
  }).passthrough(),
);

const sleep: Sleeper = (milliseconds) => Bun.sleep(milliseconds);

export interface EvidenceClient {
  fetch(token: string): Promise<MarketEvidenceType>;
}

export interface CoinGeckoClientOptions {
  fetcher?: Fetcher;
  limiter?: RateLimiter;
  attempts?: number;
  retryDelayMs?: number;
  sleeper?: Sleeper;
  now?: () => Date;
}

class NonRetryableEvidenceError extends Error {}

export class CoinGeckoClient implements EvidenceClient {
  private readonly fetcher: Fetcher;
  private readonly limiter: RateLimiter;
  private readonly attempts: number;
  private readonly retryDelayMs: number;
  private readonly sleeper: Sleeper;
  private readonly now: () => Date;

  constructor(options: CoinGeckoClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.limiter = options.limiter ?? new RateLimiter();
    this.attempts = options.attempts ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.sleeper = options.sleeper ?? sleep;
    this.now = options.now ?? (() => new Date());
  }

  async fetch(token: string): Promise<MarketEvidenceType> {
    const normalized = token.toUpperCase();
    const id = COINGECKO_IDS[normalized];
    if (!id) throw new NonRetryableEvidenceError(`No CoinGecko id configured for ${normalized}`);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_market_cap=true&include_24hr_change=true`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        await this.limiter.wait();
        const response = await this.fetcher(url, {
          headers: { "user-agent": "EchoLedger/0.1 (practice research evidence)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const payload = CoinGeckoResponse.parse(await response.json());
          const snapshot = payload[id];
          if (!snapshot) throw new Error(`CoinGecko response omitted ${id}`);
          return MarketEvidence.parse({
            price: snapshot.usd,
            change_24h_pct: snapshot.usd_24h_change,
            market_cap: snapshot.usd_market_cap ?? null,
            fetched_at: this.now().toISOString(),
            source: "CoinGecko",
          });
        }
        const error = new Error(`CoinGecko HTTP ${response.status}`);
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          throw new NonRetryableEvidenceError(error.message);
        }
        lastError = error;
      } catch (error) {
        if (error instanceof NonRetryableEvidenceError) throw error;
        lastError = error;
      }
      if (attempt < this.attempts) await this.sleeper(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch CoinGecko evidence for ${normalized}`);
  }
}