import { useEffect, useState } from "react";

/**
 * Evidence that lives outside Ethereum: the exchange's own public record of the price at the minute a position was
 * opened or settled. Binance publishes 1-minute candles without an API key, so anyone can open the same URL.
 */
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

export const binanceSymbol = (token: string) => `${token.toUpperCase()}USDT`;

export function klineUrl(token: string, iso: string, host = HOSTS[0]) {
  const minute = Math.floor(Date.parse(iso) / 60_000) * 60_000;
  return `${host}/api/v3/klines?symbol=${binanceSymbol(token)}&interval=1m&startTime=${minute}&limit=1`;
}

export type Candle = { open: number; high: number; low: number; close: number; url: string };
type State = { status: "loading" } | { status: "ok"; candle: Candle } | { status: "error"; url: string };

const cache = new Map<string, Promise<Candle>>();

async function fetchCandle(token: string, iso: string): Promise<Candle> {
  let lastError: unknown;
  for (const host of HOSTS) {
    const url = klineUrl(token, iso, host);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = (await response.json()) as Array<[number, string, string, string, string]>;
      const row = rows[0];
      if (!row) throw new Error("no candle");
      return { open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function useCandle(token: string, iso: string | null | undefined): State | null {
  const [state, setState] = useState<State | null>(iso ? { status: "loading" } : null);
  useEffect(() => {
    if (!iso) return;
    const key = `${token}|${iso}`;
    if (!cache.has(key)) cache.set(key, fetchCandle(token, iso));
    let live = true;
    setState({ status: "loading" });
    cache.get(key)!.then(
      (candle) => live && setState({ status: "ok", candle }),
      () => {
        cache.delete(key);
        if (live) setState({ status: "error", url: klineUrl(token, iso) });
      },
    );
    return () => {
      live = false;
    };
  }, [token, iso]);
  return state;
}

/** How far the on-chain price sits from the exchange's own 1-minute range (0 when inside it). */
export function gapPct(price: number, candle: Candle) {
  if (price >= candle.low && price <= candle.high) return 0;
  const edge = price < candle.low ? candle.low : candle.high;
  return (Math.abs(price - edge) / edge) * 100;
}
