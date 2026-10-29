import { useEffect, useState } from "react";
import { exampleCards } from "@echo/shared/fixtures";
import { readLedgerSnapshot, type LedgerSnapshot } from "@echo/shared/ledger";
import watchlist from "../../../agent/kols.json";

/** Block the staging EchoLedger was deployed at (matches cre/settle/config.staging.json). */
const DEFAULT_FROM_BLOCK = "11974596";
const REFRESH_MS = 60_000;

/** The live practice deployment; override with VITE_LEDGER_ADDRESS. */
export const LEDGER_ADDRESS = (import.meta.env.VITE_LEDGER_ADDRESS as string | undefined)?.trim() || "0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0";

type Kol = { id: string; handle: string; platform: string };
const kols = watchlist as Kol[];

/** kolIds on chain are keccak256 of a card source's `kol`, which is the watchlist handle (fixtures use plain names). */
const KNOWN_KOL_NAMES = [...new Set([...kols.map((kol) => kol.handle), ...exampleCards.flatMap((card) => card.sources.map((source) => source.kol))])];

export function platformFor(label: string | null): string {
  if (!label) return "on-chain id";
  return kols.find((kol) => kol.handle === label)?.platform ?? "fixture";
}

export type LedgerState =
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "live"; snapshot: LedgerSnapshot }
  | { status: "error"; error: string; snapshot?: LedgerSnapshot };

let state: LedgerState = LEDGER_ADDRESS ? { status: "loading" } : { status: "unconfigured" };
const listeners = new Set<(next: LedgerState) => void>();
let started = false;

function publish(next: LedgerState) {
  state = next;
  for (const listener of listeners) listener(next);
}

async function refresh() {
  if (!LEDGER_ADDRESS) return;
  try {
    const snapshot = await readLedgerSnapshot({
      address: LEDGER_ADDRESS as `0x${string}`,
      fromBlock: BigInt((import.meta.env.VITE_LEDGER_FROM_BLOCK as string | undefined) || DEFAULT_FROM_BLOCK),
      rpcUrl: (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) || undefined,
      knownKolNames: KNOWN_KOL_NAMES,
    });
    publish({ status: "live", snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    // Keep the last good snapshot on screen if a later refresh fails.
    publish({ status: "error", error: message, snapshot: state.status === "live" ? state.snapshot : undefined });
  }
}

/** One shared poller for every screen, so Radar, Scorecard and Card Detail read the same snapshot. */
export function useLedger(): LedgerState {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    if (!started && LEDGER_ADDRESS) {
      started = true;
      void refresh();
      window.setInterval(() => void refresh(), REFRESH_MS);
    }
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}

export const etherscanTx = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
export const etherscanAddress = (address: string) => `https://sepolia.etherscan.io/address/${address}`;
export const shortHash = (hash: string, start = 8, end = 6) => (hash.length > start + end + 1 ? `${hash.slice(0, start)}…${hash.slice(-end)}` : hash);
