export type MockPosition = {
  id: string;
  token: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice?: number;
  openedAt: string;
  settledAt?: string;
};

export type MockKolRecord = {
  id: string;
  handle: string;
  channel: "x" | "telegram" | "discord";
  trustHistory: readonly number[];
  winCalls: number;
  lossCalls: number;
  echoCalls: number;
};

// Raw stand-ins for EchoLedger positions and CRE settlement output.
// SOL demonstrates repeated wins; ETH and LINK contain mixed long/short results.
export const mockPositions: readonly MockPosition[] = [
  { id: "pos-sol-001", token: "SOL", side: "long", entryPrice: 142.2, exitPrice: 148.8, openedAt: "2026-09-28T10:00:00Z", settledAt: "2026-09-29T10:00:00Z" },
  { id: "pos-eth-001", token: "ETH", side: "long", entryPrice: 3820, exitPrice: 3732, openedAt: "2026-10-01T09:00:00Z", settledAt: "2026-10-02T09:00:00Z" },
  { id: "pos-sol-002", token: "SOL", side: "short", entryPrice: 151.4, exitPrice: 146.1, openedAt: "2026-10-03T12:00:00Z", settledAt: "2026-10-04T12:00:00Z" },
  { id: "pos-link-001", token: "LINK", side: "long", entryPrice: 18.4, exitPrice: 19.7, openedAt: "2026-10-06T08:30:00Z", settledAt: "2026-10-07T08:30:00Z" },
  { id: "pos-eth-002", token: "ETH", side: "short", entryPrice: 3910, exitPrice: 3840, openedAt: "2026-10-09T11:00:00Z", settledAt: "2026-10-10T11:00:00Z" },
  { id: "pos-sol-003", token: "SOL", side: "long", entryPrice: 147.8, exitPrice: 156.2, openedAt: "2026-10-12T14:00:00Z", settledAt: "2026-10-13T14:00:00Z" },
  { id: "pos-link-002", token: "LINK", side: "short", entryPrice: 20.1, exitPrice: 20.8, openedAt: "2026-10-15T07:00:00Z", settledAt: "2026-10-16T07:00:00Z" },
  { id: "pos-eth-003", token: "ETH", side: "long", entryPrice: 3760, exitPrice: 3847, openedAt: "2026-10-17T16:00:00Z", settledAt: "2026-10-18T16:00:00Z" },
  { id: "pos-sol-004", token: "SOL", side: "long", entryPrice: 158.1, exitPrice: 161.3, openedAt: "2026-10-19T13:00:00Z", settledAt: "2026-10-20T13:00:00Z" },
  { id: "pos-sol-005", token: "SOL", side: "long", entryPrice: 160.4, openedAt: "2026-10-21T12:30:00Z" },
  { id: "pos-link-003", token: "LINK", side: "short", entryPrice: 21.2, openedAt: "2026-10-22T10:15:00Z" },
];

// Histories are oldest -> newest and model indexed TrustUpdated snapshots.
export const mockKolRecords: readonly MockKolRecord[] = [
  { id: "kol-alice", handle: "alice-crypto", channel: "x", trustHistory: [7420, 7680, 8010, 8420], winCalls: 7, lossCalls: 2, echoCalls: 1 },
  { id: "kol-block", handle: "block-research", channel: "telegram", trustHistory: [7310, 7590, 7760, 7980], winCalls: 6, lossCalls: 2, echoCalls: 0 },
  { id: "kol-chain", handle: "chain-signals", channel: "discord", trustHistory: [6590, 6920, 7180, 7460], winCalls: 5, lossCalls: 3, echoCalls: 2 },
  { id: "kol-momentum", handle: "momentum-desk", channel: "discord", trustHistory: [7350, 7010, 6730, 6410], winCalls: 3, lossCalls: 5, echoCalls: 6 },
  { id: "kol-scout", handle: "small-cap-scout", channel: "x", trustHistory: [6110, 6200, 6180, 6190], winCalls: 2, lossCalls: 2, echoCalls: 1 },
];