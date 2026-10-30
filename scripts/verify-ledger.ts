// Re-derives the EchoLedger track record from public chain data and exits non-zero if anything does not add up.
//   bun run verify                          read the live Sepolia ledger, then audit it
//   bun run verify --snapshot file.json     audit a saved snapshot offline (e.g. shared/test/fixtures/ledger-snapshot.json)
//   bun run verify --json                   machine-readable output
import { readFileSync } from "node:fs";
import { auditLedger } from "../shared/src/audit";
import { readLedgerSnapshot, type LedgerSnapshot } from "../shared/src/ledger";
import { exampleCards } from "../shared/src/fixtures";
import watchlist from "../agent/kols.json";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function load(): Promise<LedgerSnapshot> {
  const file = value("--snapshot");
  if (file) return JSON.parse(readFileSync(file, "utf8")) as LedgerSnapshot;
  const names = [
    ...new Set([
      ...(watchlist as Array<{ handle: string }>).map((kol) => kol.handle),
      ...exampleCards.flatMap((card) => card.sources.map((source) => source.kol)),
    ]),
  ];
  return readLedgerSnapshot({
    address: (process.env.VITE_LEDGER_ADDRESS || "0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0") as `0x${string}`,
    fromBlock: BigInt(process.env.VITE_LEDGER_FROM_BLOCK || "11974596"),
    rpcUrl: process.env.VITE_SEPOLIA_RPC_URL || undefined,
    knownKolNames: names,
  });
}

const snapshot = await load();
const audit = auditLedger(snapshot);

if (flag("--json")) {
  console.log(JSON.stringify({ address: snapshot.address, latestBlock: snapshot.latestBlock, ...audit }, null, 2));
} else {
  const settled = snapshot.positions.filter((p) => p.settled).length;
  console.log(`EchoLedger ${snapshot.address} @ block ${snapshot.latestBlock}`);
  console.log(`${snapshot.positions.length} decisions, ${settled} settled, ${snapshot.trustUpdates.length} trust updates\n`);
  for (const check of audit.checks) {
    const mark = check.passed === check.total ? "PASS" : "FAIL";
    console.log(`${mark}  ${check.label.padEnd(42)} ${check.passed}/${check.total}`);
    for (const failure of check.failures) console.log(`        ✗ ${failure.subject}: ${failure.message}`);
  }
  console.log(`\n${audit.ok ? "All" : `${audit.passed} of`} ${audit.total} checks ${audit.ok ? "pass" : "pass, the rest FAIL"}.`);
}
process.exit(audit.ok ? 0 : 1);
