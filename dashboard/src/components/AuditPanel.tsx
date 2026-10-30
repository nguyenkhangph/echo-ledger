import { useMemo, useState } from "react";
import { auditForPosition, auditLedger, type AuditResult } from "@echo/shared/audit";
import type { LedgerPosition, LedgerSnapshot } from "@echo/shared/ledger";
import { etherscanTx, LEDGER_ADDRESS, shortHash } from "../data/ledger";

export function useAudit(snapshot: LedgerSnapshot): AuditResult {
  return useMemo(() => auditLedger(snapshot), [snapshot]);
}

const sepoliaChainId = 11155111;
const bigintSafe = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Everything a third party needs to re-check one decision, plus a SHA-256 of the body so a copy cannot be quietly edited. */
export async function buildProofPack(position: LedgerPosition, snapshot: LedgerSnapshot, audit: AuditResult) {
  const body = {
    kind: "echo-ledger/proof-pack@1",
    chain: { name: "Ethereum Sepolia", chainId: sepoliaChainId },
    contract: snapshot.address,
    readAtBlock: snapshot.latestBlock,
    position,
    audit: auditForPosition(audit, position),
    verifyWith: "bun run verify  (github.com/nguyenkhangph/echo-ledger)",
    transactions: {
      open: etherscanTx(position.openTx),
      ...(position.settleTx ? { settle: etherscanTx(position.settleTx) } : {}),
    },
  };
  const text = JSON.stringify(body, bigintSafe, 2);
  return { sha256: await sha256Hex(text), body: JSON.parse(text) as unknown };
}

export function ProofPackButton({ position, snapshot, audit }: { position: LedgerPosition; snapshot: LedgerSnapshot; audit: AuditResult }) {
  const [hash, setHash] = useState<string | null>(null);
  const download = async () => {
    try {
      const pack = await buildProofPack(position, snapshot, audit);
      setHash(pack.sha256);
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `echo-ledger-proof-${position.token.toLowerCase()}-${position.id.slice(2, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setHash(null);
    }
  };
  return (
    <button type="button" className="proof-btn mono-font" onClick={download} title="A JSON file with the on-chain record, the re-derived checks and a SHA-256 of its contents">
      {hash ? `proof pack · sha256 ${hash.slice(0, 8)}…` : "↓ proof pack"}
    </button>
  );
}

function trustPct(score: number) {
  return `${(score / 100).toFixed(1)}%`;
}

export function AuditPanel({ snapshot, audit }: { snapshot: LedgerSnapshot; audit: AuditResult }) {
  const [open, setOpen] = useState(false);
  const failed = audit.total - audit.passed;
  return (
    <section className={`panel audit${audit.ok ? "" : " audit--fail"}`} aria-labelledby="audit-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Don't trust us, replay it · runs in your browser</p>
          <h2 id="audit-title">Independent audit</h2>
        </div>
        <span className={`audit__seal mono-font${audit.ok ? "" : " is-fail"}`}>
          <i aria-hidden="true" />
          {audit.ok ? `${audit.total}/${audit.total} checks pass` : `${failed} of ${audit.total} checks fail`}
        </span>
      </div>

      <p className="audit__lead">
        The page re-derives profit and loss, risk limits and every source's trust score from the public Sepolia record alone, with the same rules the contract and the CRE workflows apply. Nothing below is read from our own database.
      </p>

      <ul className="audit__checks">
        {audit.checks.map((check) => {
          const ok = check.passed === check.total;
          return (
            <li key={check.id} className={ok ? "is-ok" : "is-bad"}>
              <span className="audit__mark mono-font" aria-hidden="true">{ok ? "✓" : "✗"}</span>
              <div>
                <strong>{check.label}</strong>
                <small>{check.rule}</small>
                {check.failures.map((failure) => (
                  <small key={failure.subject} className="audit__failure mono-font">{failure.subject}: {failure.message}</small>
                ))}
              </div>
              <span className="audit__count mono-font">{check.passed}/{check.total}</span>
            </li>
          );
        })}
      </ul>

      <div className="audit__foot">
        <button type="button" className="audit__toggle mono-font" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} the trust replay ({audit.replay.length} steps)
        </button>
        <code className="audit__cmd mono-font">$ bun run verify</code>
      </div>

      {open && (
        <div className="audit__table-wrap">
          <table className="audit__table mono-font">
            <thead>
              <tr><th>Source</th><th>Position</th><th>Result</th><th>Rule</th><th>On chain</th><th /></tr>
            </thead>
            <tbody>
              {audit.replay.map((step) => (
                <tr key={`${step.positionId}-${step.kolId}`} className={step.onChain === step.after ? "" : "is-bad"}>
                  <td>{step.label ?? shortHash(step.kolId, 6, 4)}</td>
                  <td>{step.token} {step.pnlBps > 0 ? "+" : ""}{step.pnlBps} bps{step.echo ? " · echo" : ""}</td>
                  <td>{trustPct(step.before)} → {trustPct(step.after)}</td>
                  <td>{step.after - step.before > 0 ? "+" : ""}{(step.after - step.before) / 100} pts</td>
                  <td>{step.onChain == null ? "—" : trustPct(step.onChain)}</td>
                  <td className="audit__ok">{step.onChain === step.after ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="audit__note mono-font">Contract {LEDGER_ADDRESS ? shortHash(LEDGER_ADDRESS, 8, 6) : ""} · block {snapshot.latestBlock.toLocaleString("en-US")} · rule: +2.5 pts on a win, −2.5 on a loss, −2.5 more for an echo</p>
    </section>
  );
}
