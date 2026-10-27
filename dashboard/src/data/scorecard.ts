import type { LedgerSnapshot } from "@echo/shared/ledger";
import { mockKolRecords, mockPositions } from "./scorecard.mock";
import { platformFor, shortHash, useLedger, type LedgerState } from "./ledger";

export type TokenScore = {
  token: string;
  count: number;
  winRate: number;
  avgPnlBps: number;
};

export type EquityPoint = {
  settledAt: string;
  cumulativePnlBps: number;
};

export type KolScore = {
  id: string;
  rank: number;
  handle: string;
  channel: string;
  trustScore: number;
  winCalls: number;
  lossCalls: number;
  echoCalls: number;
  trend: "up" | "down" | "flat";
  trendDelta: number;
};

export type ScorecardData = {
  portfolio: {
    totalPositions: number;
    openPositions: number;
    settledPositions: number;
    winRate: number;
    avgPnlBps: number;
    cumulativePnlBps: number;
    equityCurve: EquityPoint[];
    byToken: TokenScore[];
  };
  kols: KolScore[];
  asOf: string;
  source: { kind: "live"; block: number; address: string } | { kind: "mock"; reason: string };
};

function positionPnlBps(position: (typeof mockPositions)[number]) {
  if (position.exitPrice == null) return null;
  const movement = position.side === "long"
    ? position.exitPrice - position.entryPrice
    : position.entryPrice - position.exitPrice;
  return Math.round((movement / position.entryPrice) * 10_000);
}

function average(values: readonly number[]) {
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0;
}

function buildScorecardData(): ScorecardData {
  const settled = mockPositions
    .filter((position) => position.settledAt && position.exitPrice != null)
    .map((position) => ({ ...position, pnlBps: positionPnlBps(position)! }))
    .sort((a, b) => Date.parse(a.settledAt!) - Date.parse(b.settledAt!));
  let cumulativePnlBps = 0;
  const equityCurve = settled.map((position) => {
    cumulativePnlBps += position.pnlBps;
    return { settledAt: position.settledAt!, cumulativePnlBps };
  });
  const tokens = [...new Set(settled.map((position) => position.token))];
  const byToken = tokens.map((token) => {
    const positions = settled.filter((position) => position.token === token);
    const wins = positions.filter((position) => position.pnlBps > 0).length;
    return {
      token,
      count: positions.length,
      winRate: Math.round((wins / positions.length) * 100),
      avgPnlBps: average(positions.map((position) => position.pnlBps)),
    };
  }).sort((a, b) => b.avgPnlBps - a.avgPnlBps);

  const kols = mockKolRecords
    .map((kol) => {
      const current = kol.trustHistory.at(-1) ?? 0;
      const comparison = kol.trustHistory.at(-4) ?? kol.trustHistory[0] ?? current;
      const trendDelta = current - comparison;
      return { ...kol, trustScore: current, trendDelta, trend: trendDelta > 50 ? "up" as const : trendDelta < -50 ? "down" as const : "flat" as const };
    })
    .sort((a, b) => b.trustScore - a.trustScore)
    .map((kol, index) => ({ ...kol, rank: index + 1 }));

  const wins = settled.filter((position) => position.pnlBps > 0).length;
  return {
    portfolio: {
      totalPositions: mockPositions.length,
      openPositions: mockPositions.length - settled.length,
      settledPositions: settled.length,
      winRate: settled.length ? Math.round((wins / settled.length) * 100) : 0,
      avgPnlBps: average(settled.map((position) => position.pnlBps)),
      cumulativePnlBps,
      equityCurve,
      byToken,
    },
    kols,
    asOf: "2026-10-22T12:00:00.000Z",
    source: { kind: "mock", reason: "Sample data" },
  };
}

const mockScorecard = buildScorecardData();

/** Every watchlist source starts at trust 0.5, stored on chain as 5000 / 10000. */
const INITIAL_TRUST = 5000;

/** Scorecard figures computed only from EchoLedger events and views. */
export function buildLedgerScorecard(snapshot: LedgerSnapshot): ScorecardData {
  // REJECT decisions are recorded for audit but never become practice positions.
  const positions = snapshot.positions.filter((position) => position.attestation !== "REJECT" && position.side !== "NONE");
  const settled = positions
    .filter((position) => position.settled && position.pnlBps != null && position.settledAt)
    .sort((a, b) => Date.parse(a.settledAt!) - Date.parse(b.settledAt!));
  let cumulativePnlBps = 0;
  const equityCurve = settled.map((position) => {
    cumulativePnlBps += position.pnlBps!;
    return { settledAt: position.settledAt!, cumulativePnlBps };
  });
  const byToken = [...new Set(settled.map((position) => position.token))].map((token) => {
    const calls = settled.filter((position) => position.token === token);
    return {
      token,
      count: calls.length,
      winRate: Math.round((calls.filter((position) => position.pnlBps! > 0).length / calls.length) * 100),
      avgPnlBps: average(calls.map((position) => position.pnlBps!)),
    };
  }).sort((a, b) => b.avgPnlBps - a.avgPnlBps);

  const kols = snapshot.kols
    .map((kol) => {
      const history = snapshot.trustUpdates.filter((update) => update.kolId === kol.kolId).sort((a, b) => a.block - b.block);
      const previous = history.length > 1 ? history[history.length - 2]!.score : INITIAL_TRUST;
      const current = kol.score || INITIAL_TRUST;
      const trendDelta = current - previous;
      const independent = settled.filter((position) => position.sources.some((source) => source.kolId === kol.kolId && !source.echo));
      return {
        id: kol.kolId,
        handle: kol.label?.replace(/^@/, "") ?? shortHash(kol.kolId),
        channel: platformFor(kol.label),
        trustScore: current,
        winCalls: independent.filter((position) => position.pnlBps! > 0).length,
        lossCalls: independent.filter((position) => position.pnlBps! <= 0).length,
        echoCalls: snapshot.positions.filter((position) => position.sources.some((source) => source.kolId === kol.kolId && source.echo)).length,
        trendDelta,
        trend: trendDelta > 0 ? ("up" as const) : trendDelta < 0 ? ("down" as const) : ("flat" as const),
      };
    })
    .sort((a, b) => b.trustScore - a.trustScore)
    .map((kol, index) => ({ ...kol, rank: index + 1 }));

  const wins = settled.filter((position) => position.pnlBps! > 0).length;
  return {
    portfolio: {
      totalPositions: positions.length,
      openPositions: positions.filter((position) => !position.settled).length,
      settledPositions: settled.length,
      winRate: settled.length ? Math.round((wins / settled.length) * 100) : 0,
      avgPnlBps: average(settled.map((position) => position.pnlBps!)),
      cumulativePnlBps,
      equityCurve,
      byToken,
    },
    kols,
    asOf: snapshot.fetchedAt,
    source: { kind: "live", block: snapshot.latestBlock, address: snapshot.address },
  };
}

function mockWith(reason: string): ScorecardData {
  return { ...mockScorecard, source: { kind: "mock", reason } };
}

export function scorecardFromLedger(ledger: LedgerState): ScorecardData {
  if (ledger.status === "live") return buildLedgerScorecard(ledger.snapshot);
  if (ledger.status === "error" && ledger.snapshot) return buildLedgerScorecard(ledger.snapshot);
  if (ledger.status === "unconfigured") return mockWith("VITE_LEDGER_ADDRESS is not set");
  if (ledger.status === "error") return mockWith(`Sepolia read failed: ${ledger.error}`);
  return mockWith("Reading Sepolia…");
}

/** Single UI data boundary: live EchoLedger state when readable, labelled sample data otherwise. */
export function useScorecardData(): ScorecardData {
  return scorecardFromLedger(useLedger());
}

export function getMockScorecardData(): ScorecardData {
  return mockScorecard;
}