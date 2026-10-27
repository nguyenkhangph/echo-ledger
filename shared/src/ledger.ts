import { createPublicClient, http, keccak256, parseAbi, toBytes, type Hex, type PublicClient, type Transport } from "viem";
import { sepolia } from "viem/chains";

/** EchoLedger read surface: the three events plus the views the dashboard needs. */
export const echoLedgerAbi = parseAbi([
  "event PositionOpened(bytes32 indexed id, string token, bytes32 indexed cardHash)",
  "event PositionSettled(bytes32 indexed id, int256 pnlBps)",
  "event TrustUpdated(bytes32 indexed kolId, uint256 score)",
  "function getPosition(bytes32 id) view returns ((bool exists, bool settled, string token, uint8 side, uint256 sizeBps, uint256 entryPriceE8, bytes32 cardHash, uint8 attestation, uint256 reasonCode, uint256 exitPriceE8, int256 pnlBps, uint256 settledAt))",
  "function getPositionSources(bytes32 id) view returns (bytes32[] kolIds, bool[] echoFlags)",
  "function kolTrust(bytes32 kolId) view returns ((uint256 score, uint256 trades))",
]);

const SIDES = ["LONG", "SHORT", "NONE"] as const;
const ATTESTATIONS = ["APPROVE", "CONSTRAIN", "REJECT"] as const;

export type LedgerSource = { kolId: Hex; label: string | null; echo: boolean };

export type LedgerPosition = {
  id: Hex;
  token: string;
  side: (typeof SIDES)[number];
  attestation: (typeof ATTESTATIONS)[number];
  sizeBps: number;
  entryPrice: number;
  exitPrice: number | null;
  pnlBps: number | null;
  cardHash: Hex;
  settled: boolean;
  openedAt: string;
  openedBlock: number;
  openTx: Hex;
  settledAt: string | null;
  settleTx: Hex | null;
  sources: LedgerSource[];
};

export type LedgerTrustUpdate = { kolId: Hex; label: string | null; score: number; block: number; tx: Hex; at: string };

export type LedgerKol = { kolId: Hex; label: string | null; score: number; trades: number };

export type LedgerSnapshot = {
  address: Hex;
  latestBlock: number;
  fetchedAt: string;
  positions: LedgerPosition[];
  trustUpdates: LedgerTrustUpdate[];
  kols: LedgerKol[];
};

export type LedgerReadOptions = {
  address: Hex;
  fromBlock: bigint;
  /** Names that may have been hashed into kolIds (keccak256 of the card's `source.kol`). */
  knownKolNames?: readonly string[];
  rpcUrl?: string;
  /** Inject a transport in tests; defaults to batched HTTP against `rpcUrl`. */
  transport?: Transport;
  /** Public RPCs cap eth_getLogs ranges; history is read in windows of this size. */
  logChunkSize?: bigint;
};

export const DEFAULT_SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** kolIds on chain are keccak256(source.kol); recover readable names for the ones we know. */
export function kolLabeler(names: readonly string[]): (kolId: Hex) => string | null {
  const byId = new Map(names.map((name) => [keccak256(toBytes(name)).toLowerCase(), name]));
  return (kolId) => byId.get(kolId.toLowerCase()) ?? null;
}

const e8 = (value: bigint) => Number(value) / 1e8;

export async function readLedgerSnapshot(options: LedgerReadOptions): Promise<LedgerSnapshot> {
  const client = createPublicClient({
    chain: sepolia,
    transport: options.transport ?? http(options.rpcUrl ?? DEFAULT_SEPOLIA_RPC_URL, { batch: true }),
  }) as PublicClient;
  const label = kolLabeler(options.knownKolNames ?? []);
  const chunk = options.logChunkSize ?? 9_000n;
  const latest = await client.getBlockNumber();

  const logs = [];
  for (let start = options.fromBlock; start <= latest; start += chunk) {
    const end = start + chunk - 1n < latest ? start + chunk - 1n : latest;
    logs.push(...(await client.getContractEvents({ address: options.address, abi: echoLedgerAbi, fromBlock: start, toBlock: end })));
  }

  const blockTimes = new Map<bigint, string>();
  for (const blockNumber of new Set(logs.map((log) => log.blockNumber))) {
    const block = await client.getBlock({ blockNumber });
    blockTimes.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
  }

  const opened = logs.filter((log) => log.eventName === "PositionOpened");
  const settledById = new Map(
    logs.filter((log) => log.eventName === "PositionSettled").map((log) => [String(log.args.id).toLowerCase(), log]),
  );

  const positions = await Promise.all(
    opened.map(async (log): Promise<LedgerPosition> => {
      const id = log.args.id as Hex;
      const [stored, [kolIds, echoFlags]] = await Promise.all([
        client.readContract({ address: options.address, abi: echoLedgerAbi, functionName: "getPosition", args: [id] }),
        client.readContract({ address: options.address, abi: echoLedgerAbi, functionName: "getPositionSources", args: [id] }),
      ]);
      const settleLog = settledById.get(id.toLowerCase());
      return {
        id,
        token: stored.token,
        side: SIDES[stored.side] ?? "NONE",
        attestation: ATTESTATIONS[stored.attestation] ?? "REJECT",
        sizeBps: Number(stored.sizeBps),
        entryPrice: e8(stored.entryPriceE8),
        exitPrice: stored.settled ? e8(stored.exitPriceE8) : null,
        pnlBps: stored.settled ? Number(stored.pnlBps) : null,
        cardHash: stored.cardHash,
        settled: stored.settled,
        openedAt: blockTimes.get(log.blockNumber)!,
        openedBlock: Number(log.blockNumber),
        openTx: log.transactionHash,
        settledAt: stored.settled ? new Date(Number(stored.settledAt) * 1000).toISOString() : null,
        settleTx: settleLog?.transactionHash ?? null,
        sources: kolIds.map((kolId, index) => ({ kolId, label: label(kolId), echo: echoFlags[index] ?? false })),
      };
    }),
  );

  const trustUpdates = logs
    .filter((log) => log.eventName === "TrustUpdated")
    .map((log) => {
      const kolId = log.args.kolId as Hex;
      return { kolId, label: label(kolId), score: Number(log.args.score), block: Number(log.blockNumber), tx: log.transactionHash, at: blockTimes.get(log.blockNumber)! };
    });

  const kolIds = [...new Set([...positions.flatMap((p) => p.sources.map((s) => s.kolId)), ...trustUpdates.map((t) => t.kolId)])];
  const kols = await Promise.all(
    kolIds.map(async (kolId) => {
      const trust = await client.readContract({ address: options.address, abi: echoLedgerAbi, functionName: "kolTrust", args: [kolId] });
      return { kolId, label: label(kolId), score: Number(trust.score), trades: Number(trust.trades) };
    }),
  );

  return {
    address: options.address,
    latestBlock: Number(latest),
    fetchedAt: new Date().toISOString(),
    positions: positions.sort((a, b) => b.openedBlock - a.openedBlock),
    trustUpdates: trustUpdates.sort((a, b) => b.block - a.block),
    kols,
  };
}
