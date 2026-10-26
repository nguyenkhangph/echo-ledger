import { mockKolRecords, mockPositions } from "./scorecard.mock";

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
  };
}

const mockScorecard = buildScorecardData();

/**
 * Single UI data boundary. Replace this implementation with viem reads plus
 * indexed CRE settlement/trust history; Scorecard.tsx consumes no raw contract data.
 */
export function useScorecardData(): ScorecardData {
  return mockScorecard;
}

export function getMockScorecardData(): ScorecardData {
  return mockScorecard;
}