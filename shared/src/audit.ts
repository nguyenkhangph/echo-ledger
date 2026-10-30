import type { Hex } from "viem";
import type { LedgerPosition, LedgerSnapshot } from "./ledger";
import { REASONS } from "./reasons";

/**
 * Re-derives what the EchoLedger contract and the CRE workflows did from the public record alone.
 * Pure functions: no network, no randomness. The dashboard, the `verify` CLI and the tests all run this
 * same code, so "N/N checks pass" means the same thing everywhere.
 */

/** Trust rule written by cre/reputation: +delta on a win, -delta on a loss, -delta more for an echo, clamped to 0..10000. */
export const TRUST_INITIAL_SCORE = 5000;
export const TRUST_DELTA = 250;
/** Position horizon the record workflow writes and the settle workflow waits for. */
export const HORIZON_MS = 24 * 3_600_000;
/** The settle workflow also closes a position early at this loss/gain. */
export const STOP_LOSS_BPS = 800;
/** Deterministic risk gate: maximum size of one position. */
export const MAX_SIZE_BPS = 500;
/** The reputation workflow answers a finalized settlement within minutes; allow generous slack. */
export const TRUST_WINDOW_MS = 30 * 60_000;
/** The dashboard keeps prices as floats; the contract keeps integers. One bp of rounding is expected. */
const PNL_TOLERANCE_BPS = 1;

export type TrustState = { score: number; trades: number };

export function nextTrust(current: TrustState | undefined, pnlBps: number, isEcho: boolean): TrustState {
  let score = current && current.trades > 0 ? current.score : TRUST_INITIAL_SCORE;
  if (pnlBps > 0) score += TRUST_DELTA;
  if (pnlBps < 0) score -= TRUST_DELTA;
  if (isEcho) score -= TRUST_DELTA;
  score = Math.min(10_000, Math.max(0, score));
  return { score, trades: (current?.trades ?? 0) + 1 };
}

/** What the contract computes: integer division truncating toward zero, sign by side. */
export function expectedPnlBps(side: LedgerPosition["side"], entry: number, exit: number): number {
  if (side === "NONE" || entry <= 0) return 0;
  const move = side === "LONG" ? exit - entry : entry - exit;
  return Math.trunc((move * 10_000) / entry);
}

export type AuditFailure = { subject: string; message: string };

export type AuditCheck = {
  id: string;
  label: string;
  /** What the rule is, in one sentence a lawyer can read. */
  rule: string;
  passed: number;
  total: number;
  failures: AuditFailure[];
};

export type ReplayStep = {
  positionId: Hex;
  token: string;
  settledAt: string;
  pnlBps: number;
  kolId: Hex;
  label: string | null;
  before: number;
  after: number;
  trades: number;
  echo: boolean;
  /** Score the TrustUpdated event actually carried, when one was found for this step. */
  onChain: number | null;
};

export type AuditResult = {
  ok: boolean;
  passed: number;
  total: number;
  checks: AuditCheck[];
  replay: ReplayStep[];
};

const short = (hash: string) => `${hash.slice(0, 10)}…`;
const name = (label: string | null, kolId: string) => label ?? short(kolId);

const makeCheck = (id: string, label: string, rule: string): AuditCheck => ({ id, label, rule, passed: 0, total: 0, failures: [] });
function record(check: AuditCheck, ok: boolean, subject: string, message: string) {
  check.total += 1;
  if (ok) check.passed += 1;
  else check.failures.push({ subject, message });
}

export function auditLedger(snapshot: LedgerSnapshot): AuditResult {
  const positions = snapshot.positions;
  const settled = positions
    .filter((p) => p.settled && p.side !== "NONE" && p.settledAt)
    .sort((a, b) => Date.parse(a.settledAt!) - Date.parse(b.settledAt!));

  const pnl = makeCheck("pnl", "Profit and loss re-derived", "pnl = (exit − entry) ÷ entry × 10,000, signed by side, truncated toward zero.");
  for (const p of settled) {
    if (p.exitPrice == null || p.pnlBps == null) {
      record(pnl, false, short(p.id), "settled position has no exit price or pnl");
      continue;
    }
    const expected = expectedPnlBps(p.side, p.entryPrice, p.exitPrice);
    record(pnl, Math.abs(expected - p.pnlBps) <= PNL_TOLERANCE_BPS, short(p.id), `${p.token}: chain says ${p.pnlBps} bps, prices give ${expected} bps`);
  }

  const horizon = makeCheck("horizon", "Closed only at the horizon", "A position closes after 24 hours, or earlier only when the 8% stop is hit.");
  for (const p of settled) {
    const heldMs = Date.parse(p.settledAt!) - Date.parse(p.openedAt);
    const early = Math.abs(p.pnlBps ?? 0) >= STOP_LOSS_BPS;
    record(horizon, heldMs >= HORIZON_MS - 60_000 || early, short(p.id), `${p.token}: held ${(heldMs / 3_600_000).toFixed(2)} h with ${p.pnlBps} bps`);
  }

  const size = makeCheck("size", "Position size within the risk limit", `No opened position is larger than ${MAX_SIZE_BPS / 100}% of the book.`);
  for (const p of positions.filter((p) => p.side !== "NONE")) {
    record(size, p.sizeBps <= MAX_SIZE_BPS, short(p.id), `${p.token}: size ${p.sizeBps / 100}%`);
  }

  const rejects = makeCheck("reject", "Rejected decisions never trade", "A REJECT is recorded for the audit trail but opens no position and never settles.");
  for (const p of positions.filter((p) => p.attestation === "REJECT" || p.side === "NONE")) {
    record(rejects, p.side === "NONE" && p.sizeBps === 0 && !p.settled, short(p.id), `${p.token}: side ${p.side}, size ${p.sizeBps}, settled ${p.settled}`);
  }

  const grounds = makeCheck("grounds", "Every decision states its grounds", "The reason code stored with each decision is a known risk-gate reason and matches the attestation.");
  for (const p of positions.filter((p) => p.reasonCode !== undefined)) {
    const reason = REASONS[p.reasonCode!];
    record(grounds, Boolean(reason) && reason!.attestation === p.attestation, short(p.id), `${p.token}: ${p.attestation} recorded with reason code ${p.reasonCode}`);
  }

  // Trust replay: apply the reputation rule to every settlement in order, then compare with what the contract holds.
  const state = new Map<string, TrustState>();
  const replay: ReplayStep[] = [];
  const eventsByKol = new Map<string, Array<{ score: number; block: number }>>();
  for (const update of [...snapshot.trustUpdates].sort((a, b) => a.block - b.block)) {
    const key = update.kolId.toLowerCase();
    eventsByKol.set(key, [...(eventsByKol.get(key) ?? []), { score: update.score, block: update.block }]);
  }
  const cursor = new Map<string, number>();
  for (const p of settled) {
    for (const source of p.sources) {
      const key = source.kolId.toLowerCase();
      const before = state.get(key)?.trades ? state.get(key)!.score : TRUST_INITIAL_SCORE;
      const after = nextTrust(state.get(key), p.pnlBps ?? 0, source.echo);
      state.set(key, after);
      const index = cursor.get(key) ?? 0;
      cursor.set(key, index + 1);
      replay.push({
        positionId: p.id,
        token: p.token,
        settledAt: p.settledAt!,
        pnlBps: p.pnlBps ?? 0,
        kolId: source.kolId,
        label: source.label,
        before,
        after: after.score,
        trades: after.trades,
        echo: source.echo,
        onChain: eventsByKol.get(key)?.[index]?.score ?? null,
      });
    }
  }

  const events = makeCheck("trust-events", "Every trust update replayed", "Each TrustUpdated event carries exactly the score the reputation rule gives after that settlement.");
  for (const step of replay) {
    record(events, step.onChain === step.after, `${name(step.label, step.kolId)} · ${short(step.positionId)}`, `rule gives ${step.after}, chain has ${step.onChain ?? "no event"}`);
  }
  // Events nobody can explain: more TrustUpdated events than replayed settlements.
  for (const [key, list] of eventsByKol) {
    const replayed = replay.filter((step) => step.kolId.toLowerCase() === key).length;
    if (list.length !== replayed) {
      record(events, false, short(key), `${list.length} trust events on chain, ${replayed} settlements explain them`);
    }
  }

  const finals = makeCheck("trust-final", "Final trust scores match the contract", "The score and trade count the contract stores for each source equal the replayed ones.");
  for (const kol of snapshot.kols) {
    const expected = state.get(kol.kolId.toLowerCase());
    if (!expected) {
      record(finals, kol.trades === 0, name(kol.label, kol.kolId), `contract shows ${kol.trades} trades but no settlement explains them`);
      continue;
    }
    record(finals, expected.score === kol.score && expected.trades === kol.trades, name(kol.label, kol.kolId), `rule gives ${expected.score}/${expected.trades}, contract has ${kol.score}/${kol.trades}`);
  }

  const timing = makeCheck("trust-timing", "Reputation answered each settlement", "A trust update follows every settlement within 30 minutes.");
  for (const p of settled) {
    const at = Date.parse(p.settledAt!);
    const ids = new Set(p.sources.map((s) => s.kolId.toLowerCase()));
    const answered = snapshot.trustUpdates.some((u) => ids.has(u.kolId.toLowerCase()) && Date.parse(u.at) >= at - 60_000 && Date.parse(u.at) <= at + TRUST_WINDOW_MS);
    record(timing, answered, short(p.id), `${p.token}: no trust update within 30 min of settlement`);
  }

  const checks = [pnl, horizon, size, rejects, grounds, events, finals, timing].filter((check) => check.total > 0);
  const passed = checks.reduce((sum, check) => sum + check.passed, 0);
  const total = checks.reduce((sum, check) => sum + check.total, 0);
  return { ok: passed === total, passed, total, checks, replay };
}

/** The slice of an audit that concerns one position, for the proof pack. */
export function auditForPosition(audit: AuditResult, position: LedgerPosition) {
  const id = short(position.id);
  return {
    checks: audit.checks.map((check) => ({
      id: check.id,
      label: check.label,
      rule: check.rule,
      failures: check.failures.filter((failure) => failure.subject.includes(id)).length,
    })),
    trustSteps: audit.replay.filter((step) => step.positionId === position.id),
  };
}
