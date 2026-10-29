// Reads the live EchoLedger from Sepolia (same loader as the dashboard) and writes ledger-snapshot.json.
// Usage (repo root):  bun run scripts/export-ledger-snapshot.ts [out.json]
import { readLedgerSnapshot } from "../shared/src/ledger";
import { exampleCards } from "../shared/src/fixtures";
import watchlist from "../agent/kols.json";

const ADDRESS = (process.env.VITE_LEDGER_ADDRESS || "0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0") as `0x${string}`;
const FROM_BLOCK = BigInt(process.env.VITE_LEDGER_FROM_BLOCK || "11974596");
const out = process.argv[2] || "ledger-snapshot.json";

const names = [
  ...new Set([
    ...(watchlist as Array<{ handle: string }>).map((kol) => kol.handle),
    ...exampleCards.flatMap((card) => card.sources.map((source) => source.kol)),
  ]),
];

const snapshot = await readLedgerSnapshot({
  address: ADDRESS,
  fromBlock: FROM_BLOCK,
  rpcUrl: process.env.VITE_SEPOLIA_RPC_URL || undefined,
  knownKolNames: names,
});
await Bun.write(out, JSON.stringify(snapshot, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const settled = snapshot.positions.filter((p) => p.settled).length;
console.log(`wrote ${out}: ${snapshot.positions.length} positions, ${settled} settled, ${snapshot.trustUpdates.length} trust updates, block ${snapshot.latestBlock}`);
for (const p of snapshot.positions.filter((p) => p.token === "BTC").slice(-2)) {
  console.log(p.id.slice(0, 10), p.side, p.settled ? `settled ${p.pnlBps} bps  ${p.settleTx}` : "open");
}
