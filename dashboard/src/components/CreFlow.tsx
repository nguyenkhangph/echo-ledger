import type { LedgerSnapshot } from "@echo/shared/ledger";
import { etherscanAddress, etherscanTx, LEDGER_ADDRESS, shortHash, useLedger } from "../data/ledger";
import { pipelineStats, watchlist } from "../data/pipeline";
import { Reveal, SectionHeading } from "./SiteChrome";

const SOURCIFY = (address: string) => `https://repo.sourcify.dev/11155111/${address}`;

function when(iso: string | null | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

type Lane = {
  key: string;
  trigger: string;
  triggerSub: string;
  loop?: boolean;
  name: string;
  does: string;
  tags: string[];
  event: string;
  count: number | null;
  latestTx?: string;
  latestAt?: string | null;
};

function lanesFrom(snapshot: LedgerSnapshot | undefined): Lane[] {
  const byOpen = [...(snapshot?.positions ?? [])].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const bySettle = (snapshot?.positions ?? []).filter((p) => p.settled && p.settleTx).sort((a, b) => Date.parse(b.settledAt!) - Date.parse(a.settledAt!));
  const byTrust = [...(snapshot?.trustUpdates ?? [])].sort((a, b) => b.block - a.block);
  return [
    {
      key: "record",
      trigger: "HTTP trigger",
      triggerSub: "agent submits a reasoning card",
      name: "record",
      does: "Re-validates the card, fetches 3 price sources that must agree within 1%, applies the risk gate (approve, constrain or reject) and writes the decision.",
      tags: ["schema check", "price consensus", "risk gate"],
      event: "PositionOpened",
      count: snapshot ? snapshot.positions.length : null,
      latestTx: byOpen[0]?.openTx,
      latestAt: byOpen[0]?.openedAt,
    },
    {
      key: "settle",
      trigger: "Cron trigger",
      triggerSub: "scans open positions on a schedule",
      name: "settle",
      does: "Takes the median of CoinGecko, Binance and Coinbase (2 of 3 needed) and closes each position at its 24-hour horizon or the 8% stop.",
      tags: ["median of 3", "24 h horizon", "8% stop"],
      event: "PositionSettled",
      count: snapshot ? snapshot.positions.filter((p) => p.settled).length : null,
      latestTx: bySettle[0]?.settleTx ?? undefined,
      latestAt: bySettle[0]?.settledAt,
    },
    {
      key: "reputation",
      trigger: "EVM log trigger",
      triggerSub: "fires on a finalized PositionSettled",
      loop: true,
      name: "reputation",
      does: "Reads the settled result and every source behind it, then moves each source's trust: +2.5 on a win, −2.5 on a loss, −2.5 more for an echo.",
      tags: ["finalized logs", "per-source", "echo penalty"],
      event: "TrustUpdated",
      count: snapshot ? snapshot.trustUpdates.length : null,
      latestTx: byTrust[0]?.tx,
      latestAt: byTrust[0]?.at,
    },
  ];
}

export function CreFlow() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const lanes = lanesFrom(snapshot);

  return (
    <section className="page-section" id="cre" aria-labelledby="cre-title">
      <Reveal>
        <SectionHeading id="cre-title" eyebrow="Chainlink CRE · three workflows" title="The agent decides. Chainlink writes the record." />
        <p className="cre__intro mono-font">
          The agent never holds a key to the ledger. Every write goes through a Chainlink CRE workflow, which re-checks the decision with its own data and
          delivers a signed report through the Keystone forwarder. The contract accepts reports from nowhere else.
        </p>
      </Reveal>

      <Reveal className="cre">
        <div className="cre__agent">
          <span className="cre__kicker mono-font">Off-chain · AI agent</span>
          <strong className="display-font">Echo Ledger agent</strong>
          <ol className="cre__steps mono-font">
            <li><b>{watchlist.length}</b> voices read</li>
            <li><b>{pipelineStats.postsInWindow ?? "—"}</b> posts in 24 h</li>
            <li><b>{pipelineStats.echoesTotal}</b> echoes folded</li>
            <li>bull · bear · judge</li>
            <li className="cre__out">reasoning card + keccak256</li>
          </ol>
        </div>

        <div className="cre__lanes">
          {lanes.map((lane, index) => (
            <div key={lane.key} className={`cre__lane cre__lane--${lane.key}`} style={{ ["--i" as string]: index }}>
              <span className="cre__wire" aria-hidden="true" />
              <div className={`cre__trigger${lane.loop ? " cre__trigger--loop" : ""}`}>
                <span className="mono-font">{lane.trigger}</span>
                <small className="mono-font">{lane.triggerSub}</small>
                {lane.loop && <em className="mono-font">↺ from settle</em>}
              </div>
              <span className="cre__wire" aria-hidden="true" />
              <div className="cre__wf">
                <div className="cre__wf-head">
                  <span className="cre__badge mono-font">CRE workflow</span>
                  <strong className="mono-font">{lane.name}</strong>
                </div>
                <p>{lane.does}</p>
                <div className="cre__tags">
                  {lane.tags.map((tag) => <span key={tag} className="mono-font">{tag}</span>)}
                </div>
              </div>
              <span className="cre__wire" aria-hidden="true" />
              <div className="cre__event">
                <span className="mono-font cre__event-name">{lane.event}</span>
                <strong className="display-font">{lane.count ?? "—"}</strong>
                {lane.latestTx ? (
                  <a className="tx-link mono-font" href={etherscanTx(lane.latestTx)} target="_blank" rel="noreferrer" title={lane.latestTx}>
                    latest {shortHash(lane.latestTx, 4, 4)} ↗
                  </a>
                ) : (
                  <small className="mono-font">no report yet</small>
                )}
                {lane.latestAt && <small className="mono-font">{when(lane.latestAt)}</small>}
              </div>
            </div>
          ))}
        </div>

        <div className="cre__contract">
          <span className="cre__kicker mono-font">On-chain · Ethereum Sepolia</span>
          <strong className="display-font">EchoLedger</strong>
          {LEDGER_ADDRESS && (
            <a className="tx-link mono-font" href={etherscanAddress(LEDGER_ADDRESS)} target="_blank" rel="noreferrer">{shortHash(LEDGER_ADDRESS, 6, 4)} ↗</a>
          )}
          <ul className="mono-font">
            <li>accepts reports only from the Keystone forwarder</li>
            <li>stores the card hash, never the card</li>
            <li>append-only: no edit, no delete</li>
          </ul>
          {LEDGER_ADDRESS && (
            <a className="cre__verified mono-font" href={SOURCIFY(LEDGER_ADDRESS)} target="_blank" rel="noreferrer">✓ source verified · Sourcify exact match</a>
          )}
        </div>
      </Reveal>
    </section>
  );
}
