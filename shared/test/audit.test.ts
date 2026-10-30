import { describe, expect, test } from "bun:test";
import snapshot from "./fixtures/ledger-snapshot.json";
import { auditForPosition, auditLedger, expectedPnlBps, nextTrust } from "../src/audit";
import type { LedgerSnapshot } from "../src/ledger";

// The real Sepolia state read after the live run: 7 positions, 5 settled, 17 trust updates.
const live = snapshot as unknown as LedgerSnapshot;
const clone = () => structuredClone(live);

describe("auditLedger on the live run", () => {
  const audit = auditLedger(live);

  test("every check passes", () => {
    expect(audit.checks.flatMap((check) => check.failures)).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(audit.passed).toBe(audit.total);
  });

  test("replays one trust step per source per settlement", () => {
    // 4 sources x 3 wins... counted from the data: BTC#1,#2,#4 have 4,4,3 sources; BTC#6 has 4; SOL has 2.
    expect(audit.replay).toHaveLength(17);
    expect(audit.replay.every((step) => step.onChain === step.after)).toBe(true);
  });

  test("re-derives the headline results", () => {
    const pnl = Object.fromEntries(live.positions.filter((p) => p.settled).map((p) => [p.id.slice(0, 10), p.pnlBps]));
    expect(Object.values(pnl).sort()).toEqual([-1, -81, 169, 234, 72].sort());
  });
});

describe("auditLedger catches tampering", () => {
  test("a wrong pnl fails the pnl check", () => {
    const bad = clone();
    bad.positions.find((p) => p.settled)!.pnlBps = 9999;
    const result = auditLedger(bad);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "pnl")!.failures).toHaveLength(1);
  });

  test("a trust score the rule cannot explain fails the replay", () => {
    const bad = clone();
    bad.trustUpdates[0]!.score += 250;
    bad.kols.find((k) => k.kolId === bad.trustUpdates[0]!.kolId)!.score += 250;
    const result = auditLedger(bad);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "trust-events")!.failures.length).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.id === "trust-final")!.failures.length).toBeGreaterThan(0);
  });

  test("an oversized position fails the risk check", () => {
    const bad = clone();
    bad.positions.find((p) => p.side !== "NONE")!.sizeBps = 900;
    expect(auditLedger(bad).checks.find((c) => c.id === "size")!.failures).toHaveLength(1);
  });

  test("a rejected decision that traded fails", () => {
    const bad = clone();
    const reject = bad.positions.find((p) => p.attestation === "REJECT")!;
    reject.settled = true;
    expect(auditLedger(bad).checks.find((c) => c.id === "reject")!.failures).toHaveLength(1);
  });
});

describe("rules", () => {
  test("trust moves 250 per outcome, echoes cost another 250, and clamps", () => {
    expect(nextTrust(undefined, 120, false)).toEqual({ score: 5250, trades: 1 });
    expect(nextTrust({ score: 5250, trades: 1 }, -1, false)).toEqual({ score: 5000, trades: 2 });
    expect(nextTrust({ score: 5000, trades: 1 }, 10, true)).toEqual({ score: 5000, trades: 2 });
    expect(nextTrust({ score: 100, trades: 3 }, -5, true).score).toBe(0);
    expect(nextTrust({ score: 9900, trades: 3 }, 5, false).score).toBe(10_000);
  });

  test("pnl truncates toward zero like the contract", () => {
    expect(expectedPnlBps("LONG", 79561, 81428)).toBe(234);
    expect(expectedPnlBps("LONG", 80767.3, 80754)).toBe(-1);
    expect(expectedPnlBps("SHORT", 100, 99)).toBe(100);
    expect(expectedPnlBps("NONE", 100, 99)).toBe(0);
  });

  test("auditForPosition keeps only that position's steps", () => {
    const audit = auditLedger(live);
    const btc6 = live.positions.find((p) => p.id.startsWith("0x593dc78d"))!;
    expect(auditForPosition(audit, btc6).trustSteps).toHaveLength(4);
  });
});
