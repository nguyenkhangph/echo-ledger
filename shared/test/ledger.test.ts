import { describe, expect, test } from "bun:test";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  toBytes,
  toHex,
  type Hex,
} from "viem";

import { echoLedgerAbi, kolLabeler, readLedgerSnapshot } from "../src/ledger";

// Mirrors the real Sepolia run: SOL opened, settled at -81 bps, both sources cut to 4750.
const LEDGER = "0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0" as Hex;
const POSITION = "0x4ec153f00a2d837f68389ef693c02351f6532ac391164759e30721054bba6d04" as Hex;
const CARD_HASH = `0x${"ab".repeat(32)}` as Hex;
const ALICE = keccak256(toBytes("alice-crypto"));
const BLOCK = keccak256(toBytes("block-research"));
const OPEN_TX = "0x0e729f4a7b02a3f4688bb37f92775992af29dce3423c1611f883951a2219a62d" as Hex;
const SETTLE_TX = "0x38efa182cb2775e6b8e8d51173884d6496adac2f96b81538505f28581c3eca09" as Hex;
const TRUST_TX = "0x7b7459824750fa355af5c05fe4cdc50559bb0f5b14e1acf202006f627018ec7b" as Hex;

function log(blockNumber: number, transactionHash: Hex, logIndex: number, topics: Hex[], data: Hex) {
  return {
    address: LEDGER,
    blockHash: keccak256(toBytes(`block-${blockNumber}`)),
    blockNumber: toHex(blockNumber),
    data,
    logIndex: toHex(logIndex),
    removed: false,
    topics,
    transactionHash,
    transactionIndex: "0x1",
  };
}

const LOGS = [
  log(11_990_000, OPEN_TX, 0, encodeEventTopics({ abi: echoLedgerAbi, eventName: "PositionOpened", args: { id: POSITION, cardHash: CARD_HASH } }) as Hex[], encodeAbiParameters([{ type: "string" }], ["SOL"])),
  log(12_002_764, SETTLE_TX, 0, encodeEventTopics({ abi: echoLedgerAbi, eventName: "PositionSettled", args: { id: POSITION } }) as Hex[], encodeAbiParameters([{ type: "int256" }], [-81n])),
  log(12_002_765, TRUST_TX, 0, encodeEventTopics({ abi: echoLedgerAbi, eventName: "TrustUpdated", args: { kolId: ALICE } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [4750n])),
  log(12_002_765, TRUST_TX, 1, encodeEventTopics({ abi: echoLedgerAbi, eventName: "TrustUpdated", args: { kolId: BLOCK } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [4750n])),
];

function fakeRpc() {
  const logRanges: Array<[number, number]> = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const args = (params ?? []) as any[];
      if (method === "eth_blockNumber") return toHex(12_003_000);
      if (method === "eth_getLogs") {
        const from = Number(BigInt(args[0].fromBlock));
        const to = Number(BigInt(args[0].toBlock));
        logRanges.push([from, to]);
        return LOGS.filter((entry) => Number(BigInt(entry.blockNumber)) >= from && Number(BigInt(entry.blockNumber)) <= to);
      }
      if (method === "eth_getBlockByNumber") {
        const number = Number(BigInt(args[0]));
        return { number: args[0], hash: keccak256(toBytes(`block-${number}`)), timestamp: toHex(1_761_500_000 + (number - 11_990_000) * 12), transactions: [] };
      }
      if (method === "eth_call") {
        const call = decodeFunctionData({ abi: echoLedgerAbi, data: args[0].data });
        if (call.functionName === "getPosition") {
          return encodeFunctionResult({
            abi: echoLedgerAbi,
            functionName: "getPosition",
            result: {
              exists: true, settled: true, token: "SOL", side: 0, sizeBps: 500n, entryPriceE8: 10_174_000_000n, cardHash: CARD_HASH,
              attestation: 0, reasonCode: 0n, exitPriceE8: 10_091_600_000n, pnlBps: -81n, settledAt: 1_761_656_000n,
            },
          });
        }
        if (call.functionName === "getPositionSources") {
          return encodeFunctionResult({ abi: echoLedgerAbi, functionName: "getPositionSources", result: [[ALICE, BLOCK], [false, false]] });
        }
        if (call.functionName === "kolTrust") {
          return encodeFunctionResult({ abi: echoLedgerAbi, functionName: "kolTrust", result: { score: 4750n, trades: 1n } });
        }
      }
      throw new Error(`unexpected RPC ${method}`);
    },
  });
  return { transport, logRanges };
}

describe("readLedgerSnapshot", () => {
  test("joins open, settle and trust events into labelled positions", async () => {
    const { transport, logRanges } = fakeRpc();
    const snapshot = await readLedgerSnapshot({
      address: LEDGER,
      fromBlock: 11_974_596n,
      knownKolNames: ["alice-crypto", "block-research"],
      transport,
      logChunkSize: 10_000n,
    });

    expect(snapshot.latestBlock).toBe(12_003_000);
    expect(logRanges).toEqual([[11_974_596, 11_984_595], [11_984_596, 11_994_595], [11_994_596, 12_003_000]]);
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({
      id: POSITION,
      token: "SOL",
      side: "LONG",
      attestation: "APPROVE",
      settled: true,
      pnlBps: -81,
      entryPrice: 101.74,
      openTx: OPEN_TX,
      settleTx: SETTLE_TX,
      cardHash: CARD_HASH,
      sources: [
        { kolId: ALICE, label: "alice-crypto", echo: false },
        { kolId: BLOCK, label: "block-research", echo: false },
      ],
    });
    expect(snapshot.trustUpdates.map((update) => [update.label, update.score, update.tx])).toEqual([
      ["alice-crypto", 4750, TRUST_TX],
      ["block-research", 4750, TRUST_TX],
    ]);
    expect(snapshot.kols.map((kol) => [kol.label, kol.score, kol.trades])).toEqual([
      ["alice-crypto", 4750, 1],
      ["block-research", 4750, 1],
    ]);
  });

  test("leaves unknown kolIds unlabelled", () => {
    expect(kolLabeler(["alice-crypto"])(BLOCK)).toBeNull();
  });
});
