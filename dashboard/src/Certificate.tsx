import { useEffect, useMemo, useState } from "react";
import { exampleCards } from "@echo/shared/fixtures";
import { cardHash } from "@echo/shared/hash";
import { auditForPosition, auditLedger, HORIZON_MS, type AuditResult } from "@echo/shared/audit";
import type { LedgerPosition, LedgerSnapshot } from "@echo/shared/ledger";
import { buildProofPack, ProofPackButton } from "./components/AuditPanel";
import { SiteLayout } from "./components/SiteChrome";
import { draftCards } from "./data/pipeline";
import { etherscanAddress, etherscanTx, LEDGER_ADDRESS, shortHash, useLedger } from "./data/ledger";

const knownCards = new Map([...draftCards, ...exampleCards].map((card) => [cardHash(card).toLowerCase(), card.card_id]));

const fullTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const price = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
const certNo = (id: string) => `EL-${id.slice(2, 6).toUpperCase()}-${id.slice(6, 10).toUpperCase()}`;

function Seal({ ok, passed, total }: { ok: boolean; passed: number; total: number }) {
  const ring = ok ? "ECHO LEDGER · VERIFIED ON-CHAIN · SEPOLIA · " : "ECHO LEDGER · DISCREPANCY FOUND · SEPOLIA · ";
  return (
    <svg className={`cert-seal${ok ? "" : " is-fail"}`} viewBox="0 0 200 200" role="img" aria-label={ok ? `Verified, ${passed} of ${total} checks pass` : "Discrepancy found"}>
      <defs>
        <path id="seal-ring" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0" />
      </defs>
      <circle cx="100" cy="100" r="94" className="cert-seal__edge" />
      <circle cx="100" cy="100" r="88" className="cert-seal__line" />
      <circle cx="100" cy="100" r="58" className="cert-seal__line" />
      <text className="cert-seal__ring"><textPath href="#seal-ring" startOffset="0" textLength={458} lengthAdjust="spacingAndGlyphs">{ring}</textPath></text>
      <text x="100" y="92" textAnchor="middle" className="cert-seal__big">{ok ? `${passed}/${total}` : "✗"}</text>
      <text x="100" y="114" textAnchor="middle" className="cert-seal__small">{ok ? "CHECKS PASS" : "DO NOT RELY"}</text>
      <text x="100" y="130" textAnchor="middle" className="cert-seal__tiny">re-derived in browser</text>
    </svg>
  );
}

function CertificateBody({ position, snapshot, audit }: { position: LedgerPosition; snapshot: LedgerSnapshot; audit: AuditResult }) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void buildProofPack(position, snapshot, audit).then((pack) => live && setFingerprint(pack.sha256));
    return () => {
      live = false;
    };
  }, [position, snapshot, audit]);

  const slice = auditForPosition(audit, position);
  const recordedOnly = position.side === "NONE";
  const cardId = knownCards.get(position.cardHash.toLowerCase());
  const pnl = position.pnlBps;
  const relevant = slice.checks.filter((check) => audit.checks.find((c) => c.id === check.id));
  const steps = slice.trustSteps;
  const trustTx = steps.length ? snapshot.trustUpdates.find((u) => steps.some((s) => s.kolId === u.kolId && u.score === s.after && u.at >= (position.settledAt ?? "")))?.tx : undefined;
  const trustBlock = trustTx ? snapshot.trustUpdates.find((u) => u.tx === trustTx)?.block : undefined;
  const failures = relevant.reduce((sum, c) => sum + c.failures, 0);
  const ok = audit.ok && failures === 0;

  const decisionWords = recordedOnly
    ? `a REJECT decision on ${position.token}; no position was opened`
    : `an ${position.attestation} decision to go ${position.side.toLowerCase()} ${position.token} with ${(position.sizeBps / 100).toFixed(1)}% of the practice book`;

  const outcome = recordedOnly
    ? "Recorded for audit only"
    : pnl == null
      ? `Open · settles ${fullTime(new Date(Date.parse(position.openedAt) + HORIZON_MS).toISOString())}`
      : `${pnl > 0 ? "+" : ""}${pnl} basis points (${pnl > 0 ? "gain" : pnl < 0 ? "loss" : "flat"})`;

  return (
    <article className="cert">
      <div className="cert__frame">
        <header className="cert__head">
          <div className="cert__brand">
            <span className="cert__mark" aria-hidden="true">◐</span>
            <span>Echo Ledger</span>
          </div>
          <div className="cert__no">
            <span>Certificate No.</span>
            <strong>{certNo(position.id)}</strong>
          </div>
        </header>

        <p className="cert__eyebrow">Evidence of an autonomous decision</p>
        <h1 className="cert__title">Certificate of Record</h1>
        <p className="cert__statement">
          This certifies that on <b>{fullTime(position.openedAt)}</b> the Echo Ledger agent made {decisionWords}, and that the decision, its sources and its
          outcome were written to the public EchoLedger contract on Ethereum Sepolia by Chainlink CRE workflows. Every figure below was read from that
          contract at block <b>{snapshot.latestBlock.toLocaleString("en-US")}</b> and re-derived independently in the reader's browser.
        </p>

        <div className="cert__grid">
          <section className="cert__section">
            <h2><span>I</span> Particulars</h2>
            <dl className="cert__dl">
              <dt>Subject</dt><dd>{position.token}</dd>
              <dt>Decision</dt><dd>{position.attestation}{recordedOnly ? "" : ` · ${position.side.toLowerCase()} · ${(position.sizeBps / 100).toFixed(1)}%`}</dd>
              <dt>Entry price</dt><dd>{price(position.entryPrice)} USD</dd>
              <dt>Exit price</dt><dd>{position.exitPrice == null ? "—" : `${price(position.exitPrice)} USD`}</dd>
              <dt>Outcome</dt><dd className={pnl == null ? "" : pnl > 0 ? "is-win" : pnl < 0 ? "is-loss" : ""}>{outcome}</dd>
              <dt>Reasoning card</dt>
              <dd className="cert__mono">
                {shortHash(position.cardHash, 10, 8)}
                {cardId && <> · <a href={`/card/${encodeURIComponent(cardId)}`}>open card</a></>}
              </dd>
            </dl>
          </section>

          <section className="cert__section">
            <h2><span>II</span> Sources relied upon</h2>
            <ul className="cert__sources">
              {position.sources.map((source) => {
                const step = steps.find((s) => s.kolId === source.kolId);
                return (
                  <li key={source.kolId}>
                    <span className="cert__src-name">{source.label ?? shortHash(source.kolId, 6, 4)}</span>
                    <span className={`cert__src-tag${source.echo ? " is-echo" : ""}`}>{source.echo ? "echo" : "independent"}</span>
                    <span className="cert__src-trust">{step ? `trust ${(step.before / 100).toFixed(1)}% → ${(step.after / 100).toFixed(1)}%` : recordedOnly ? "not rescored" : "pending"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <section className="cert__section">
          <h2><span>III</span> Chain of custody</h2>
          <ol className="cert__custody">
            <li>
              <span className="cert__c-step">Reasoning card hashed</span>
              <span className="cert__mono">keccak256 {shortHash(position.cardHash, 8, 6)}</span>
              <span>off-chain, by the agent</span>
            </li>
            <li>
              <span className="cert__c-step">{recordedOnly ? "Decision recorded" : "Position opened"}</span>
              <span className="cert__mono"><a href={etherscanTx(position.openTx)} target="_blank" rel="noreferrer">{shortHash(position.openTx, 8, 6)}</a> · block {position.openedBlock.toLocaleString("en-US")}</span>
              <span>{fullTime(position.openedAt)} · CRE record workflow</span>
            </li>
            {position.settled && position.settleTx && (
              <li>
                <span className="cert__c-step">Position settled</span>
                <span className="cert__mono"><a href={etherscanTx(position.settleTx)} target="_blank" rel="noreferrer">{shortHash(position.settleTx, 8, 6)}</a></span>
                <span>{position.settledAt ? fullTime(position.settledAt) : ""} · CRE settle workflow</span>
              </li>
            )}
            {trustTx && (
              <li>
                <span className="cert__c-step">Sources rescored</span>
                <span className="cert__mono"><a href={etherscanTx(trustTx)} target="_blank" rel="noreferrer">{shortHash(trustTx, 8, 6)}</a>{trustBlock ? ` · block ${trustBlock.toLocaleString("en-US")}` : ""}</span>
                <span>{steps.length} sources · CRE reputation workflow</span>
              </li>
            )}
          </ol>
        </section>

        <div className="cert__bottom">
          <section className="cert__section cert__verify">
            <h2><span>IV</span> Independent verification</h2>
            <ul>
              {relevant.map((check) => (
                <li key={check.id} className={check.failures ? "is-bad" : ""}>
                  <span aria-hidden="true">{check.failures ? "✗" : "✓"}</span> {check.label}
                </li>
              ))}
            </ul>
            <p className="cert__mono cert__fp">
              Proof pack SHA-256<br />
              {fingerprint ?? "computing…"}
            </p>
          </section>
          <Seal ok={ok} passed={audit.passed} total={audit.total} />
        </div>

        <footer className="cert__sign">
          <div><span className="cert__line" /><b>Chainlink CRE</b><small>record · settle · reputation workflows</small></div>
          <div><span className="cert__line" /><b>EchoLedger contract</b><small className="cert__mono">{LEDGER_ADDRESS ? shortHash(LEDGER_ADDRESS, 8, 6) : ""}</small></div>
          <div><span className="cert__line" /><b>Verified by the reader</b><small>{fullTime(new Date().toISOString())}</small></div>
        </footer>
        <p className="cert__fine">
          Practice position on a public test network; no capital was at risk. Not financial or legal advice. This certificate is generated from public chain
          data and can be regenerated by anyone with <span className="cert__mono">bun run verify</span>.
        </p>
      </div>
      <div className="cert__actions no-print">
        <button type="button" className="ec-button" onClick={() => window.print()}>Print / save as PDF</button>
        <ProofPackButton position={position} snapshot={snapshot} audit={audit} />
        {LEDGER_ADDRESS && <a className="ghost-button" href={etherscanAddress(LEDGER_ADDRESS)} target="_blank" rel="noreferrer">Contract on Etherscan ↗</a>}
        <a className="ghost-button" href="/#ledger">← Back to the ledger</a>
      </div>
    </article>
  );
}

export function CertificatePage({ positionId }: { positionId: string }) {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const audit = useMemo(() => (snapshot ? auditLedger(snapshot) : null), [snapshot]);
  const position = snapshot?.positions.find((p) => p.id.toLowerCase().startsWith(positionId.toLowerCase()));

  useEffect(() => {
    if (position) document.title = `Certificate ${certNo(position.id)} — Echo Ledger`;
  }, [position]);

  return (
    <SiteLayout active="card">
      <div className="cert-page">
        {!snapshot && <p className="ledger-empty mono-font panel">{ledger.status === "error" ? `Could not read Sepolia: ${ledger.error}` : "Reading the record from Ethereum Sepolia…"}</p>}
        {snapshot && !position && <p className="ledger-empty mono-font panel">No decision with id {positionId} on the ledger. <a href="/#ledger">Back to the ledger</a></p>}
        {snapshot && position && audit && <CertificateBody position={position} snapshot={snapshot} audit={audit} />}
      </div>
    </SiteLayout>
  );
}
