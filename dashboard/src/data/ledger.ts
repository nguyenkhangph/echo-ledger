import { useEffect, useState } from "react";
import { exampleCards } from "@echo/shared/fixtures";
import { readLedgerSnapshot, type LedgerSnapshot } from "@echo/shared/ledger";
import watchlist from "../../../agent/kols.json";
import fallbackSnapshot from "./ledger-fallback.json";

/** Block the staging EchoLedger was deployed at (matches cre/settle/config.staging.json). */
const DEFAULT_FROM_BLOCK = "11974596";
const REFRESH_MS = 60_000;
/** If the live read has not finished by then, show the bundled snapshot while it keeps trying. */
const FALLBACK_AFTER_MS = 9_000;
/** Public Sepolia endpoints tried in order when no RPC is configured. */
const PUBLIC_RPCS = ["https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.drpc.org"];

/** A copy of the ledger read from Sepolia at a known block, shipped with the site so the record is never blank. */
export const FALLBACK_SNAPSHOT = fallbackSnapshot as unknown as LedgerSnapshot;

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
  | { status: "error"; error: string; snapshot?: LedgerSnapshot; fallback?: boolean };

let state: LedgerState = LEDGER_ADDRESS ? { status: "loading" } : { status: "unconfigured" };
const listeners = new Set<(next: LedgerState) => void>();
let started = false;

function publish(next: LedgerState) {
  state = next;
  for (const listener of listeners) listener(next);
}

async function readLive(): Promise<LedgerSnapshot> {
  const configured = (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) || undefined;
  const rpcs = configured ? [configured] : PUBLIC_RPCS;
  let lastError: unknown;
  for (const rpcUrl of rpcs) {
    try {
      return await readLedgerSnapshot({
        address: LEDGER_ADDRESS as `0x${string}`,
        fromBlock: BigInt((import.meta.env.VITE_LEDGER_FROM_BLOCK as string | undefined) || DEFAULT_FROM_BLOCK),
        rpcUrl,
        knownKolNames: KNOWN_KOL_NAMES,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function refresh() {
  if (!LEDGER_ADDRESS) return;
  try {
    publish({ status: "live", snapshot: await readLive() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    // Keep the last good live snapshot on screen; before the first one, show the bundled snapshot.
    if (state.status === "live") publish({ status: "error", error: message, snapshot: state.snapshot });
    else publish({ status: "error", error: message, snapshot: FALLBACK_SNAPSHOT, fallback: true });
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
      window.setTimeout(() => {
        if (state.status === "loading") publish({ status: "error", error: "live read still in progress", snapshot: FALLBACK_SNAPSHOT, fallback: true });
      }, FALLBACK_AFTER_MS);
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
