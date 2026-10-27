import type { LedgerPosition, LedgerSnapshot } from "@echo/shared/ledger";
import { etherscanAddress, etherscanTx, LEDGER_ADDRESS, shortHash, useLedger } from "../data/ledger";
import { Reveal, SectionHeading } from "./SiteChrome";

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 });
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a className="tx-link" href={etherscanTx(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label} <span>{shortHash(hash)}</span> ↗
    </a>
  );
}

function PositionRow({ position }: { position: LedgerPosition }) {
  const pnl = position.pnlBps;
  return (
    <article className="ledger-row">
      <div className="ledger-row__token">
        <span className="token-icon">{position.token.slice(0, 2)}</span>
        <div>
          <strong>{position.token}</strong>
          <span className="mono-font">{position.side === "NONE" ? "no position" : `${position.side.toLowerCase()} · ${(position.sizeBps / 100).toFixed(1)}%`}</span>
        </div>
      </div>
      <span className={`ledger-badge ledger-badge--${position.attestation.toLowerCase()}`}>{position.attestation}</span>
      <div className="ledger-row__prices mono-font">
        <span>entry {formatPrice(position.entryPrice)}</span>
        <span>{position.exitPrice == null ? "exit —" : `exit ${formatPrice(position.exitPrice)}`}</span>
      </div>
      <div className="ledger-row__pnl">
        {pnl == null ? <span className="ledger-status">Open</span> : <strong className="display-font">{pnl > 0 ? "+" : ""}{pnl} bps</strong>}
        <span className="mono-font">{position.settled ? `settled ${formatTime(position.settledAt!)}` : `opened ${formatTime(position.openedAt)}`}</span>
      </div>
      <div className="ledger-row__sources mono-font">
        {position.sources.map((source) => (
          <span key={source.kolId} className={source.echo ? "is-echo" : ""} title={source.kolId}>
            {source.label ?? shortHash(source.kolId, 6, 4)}
            {source.echo ? " · echo" : ""}
          </span>
        ))}
      </div>
      <div className="ledger-row__tx">
        <TxLink hash={position.openTx} label="Open" />
        {position.settleTx && <TxLink hash={position.settleTx} label="Settle" />}
      </div>
    </article>
  );
}

function TrustFeed({ snapshot }: { snapshot: LedgerSnapshot }) {
  if (snapshot.trustUpdates.length === 0) return <p className="ledger-empty mono-font">No trust updates yet. They appear one block after a position settles.</p>;
  return (
    <ul className="trust-feed">
      {snapshot.trustUpdates.map((update) => (
        <li key={`${update.tx}-${update.kolId}`}>
          <span className="trust-feed__dot" aria-hidden="true" />
          <strong>{update.label ?? shortHash(update.kolId, 6, 4)}</strong>
          <span className="mono-font">trust → {(update.score / 100).toFixed(1)}%</span>
          <span className="mono-font trust-feed__time">{formatTime(update.at)}</span>
          <TxLink hash={update.tx} label="Tx" />
        </li>
      ))}
    </ul>
  );
}

export function OnChainLedger() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;

  return (
    <section className="page-section" id="ledger" aria-labelledby="ledger-title">
      <Reveal>
        <div className="section-heading-row">
          <SectionHeading id="ledger-title" eyebrow="On-chain ledger" title="Every decision, settlement and trust change, read from Sepolia" />
          {LEDGER_ADDRESS && (
            <a className="scan-status" href={etherscanAddress(LEDGER_ADDRESS)} target="_blank" rel="noreferrer">
              <span className="live-dot" aria-hidden="true" />
              <span className="mono-font">{snapshot ? `Block ${snapshot.latestBlock.toLocaleString("en-US")}` : "EchoLedger"} · {shortHash(LEDGER_ADDRESS, 6, 4)} ↗</span>
            </a>
          )}
        </div>
      </Reveal>

      {ledger.status === "unconfigured" && <p className="ledger-empty mono-font panel">Set VITE_LEDGER_ADDRESS in dashboard/.env to read the deployed EchoLedger contract.</p>}
      {ledger.status === "loading" && <p className="ledger-empty mono-font panel">Reading EchoLedger events from Ethereum Sepolia…</p>}
      {ledger.status === "error" && (
        <p className="ledger-empty ledger-empty--error mono-font panel">
          Could not read Sepolia{snapshot ? " (showing the last good snapshot)" : ""}: {ledger.error}
        </p>
      )}

      {snapshot && (
        <div className="ledger-grid">
          <Reveal className="panel">
            <section aria-labelledby="ledger-positions-title">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Recorded by CRE · record + settle workflows</p>
                  <h2 id="ledger-positions-title">Positions</h2>
                </div>
                <span className="count-badge">{snapshot.positions.length}</span>
              </div>
              {snapshot.positions.length === 0 ? (
                <p className="ledger-empty mono-font">No decisions recorded yet.</p>
              ) : (
                snapshot.positions.map((position) => <PositionRow key={position.id} position={position} />)
              )}
            </section>
          </Reveal>
          <Reveal className="panel" delay={90}>
            <section aria-labelledby="ledger-trust-title">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Reputation workflow · EVM log trigger</p>
                  <h2 id="ledger-trust-title">Trust updates</h2>
                </div>
                <span className="count-badge">{snapshot.trustUpdates.length}</span>
              </div>
              <TrustFeed snapshot={snapshot} />
            </section>
          </Reveal>
        </div>
      )}
    </section>
  );
}
