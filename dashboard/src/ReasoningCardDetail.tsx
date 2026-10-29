import { useState } from "react";
import type { ReasoningCard } from "@echo/shared/card";
import { cardHash } from "@echo/shared/hash";
import { Reveal, SiteLayout } from "./components/SiteChrome";
import { etherscanTx, shortHash, useLedger } from "./data/ledger";
import { decodeEntities } from "./data/pipeline";

const RADAR_THRESHOLD = 0.6;

type FixtureCard = ReasoningCard & {
  tx_hash?: string;
  evidence: ReasoningCard["evidence"] & {
    consensus_prices?: Array<{ source: string; price: number }>;
    price_deviation_pct?: number;
    market_cap_usd?: number;
  };
  risk_state?: {
    open_positions?: number;
  };
};

type RuleState = "pass" | "fail" | "pending";

function shortValue(value: string, start = 12, end = 8) {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button className="copy-button" type="button" onClick={copy} aria-label={`Copy ${label}`}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 9v4m0 4h.01M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6m0-6 6 6" />
    </svg>
  );
}

function ClockDashedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeDasharray="2.5 3.5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function decisionIcon(tone: string) {
  if (tone === "approve") return <CheckIcon />;
  if (tone === "reject") return <XCircleIcon />;
  return <AlertIcon />;
}

function Status({ state }: { state: RuleState }) {
  const icon = state === "pass" ? <CheckIcon /> : state === "fail" ? <XCircleIcon /> : <ClockDashedIcon />;
  return (
    <span className={`rule-status ${state}`}>
      {icon}
      {state === "pending" ? "Awaiting data" : state}
    </span>
  );
}

const LONG_ARGUMENT = 420;

function Bubble({ side, text }: { side: "bull" | "bear"; text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_ARGUMENT;
  return (
    <article className={`bubble bubble--${side}`}>
      <header>
        <span className="bubble__avatar" aria-hidden="true">{side === "bull" ? "▲" : "▼"}</span>
        <strong>{side === "bull" ? "Bull" : "Bear"}</strong>
        <em className="mono-font">{side === "bull" ? "argues to act" : "argues against"}</em>
      </header>
      <p className={long && !open ? "is-clamped" : undefined}>{text}</p>
      {long && (
        <button className="bubble__more mono-font" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Read the full argument"}
        </button>
      )}
    </article>
  );
}

const STAMP_RING = 2 * Math.PI * 34;

function VerdictStamp({ label, tone, confidence }: { label: string; tone: string; confidence: number }) {
  const pct = Math.min(1, Math.max(0, confidence));
  return (
    <div className={`verdict verdict--${tone}`}>
      <svg className="verdict__ring" viewBox="0 0 80 80" role="img" aria-label={`${Math.round(pct * 100)}% confidence`}>
        <circle className="verdict__ring-bg" cx={40} cy={40} r={34} />
        <circle
          className="verdict__ring-fill"
          cx={40}
          cy={40}
          r={34}
          transform="rotate(-90 40 40)"
          style={{ ["--s" as string]: `${pct * STAMP_RING}px`, ["--c" as string]: `${STAMP_RING}px` }}
        />
        <text x={40} y={45} textAnchor="middle">{Math.round(pct * 100)}%</text>
      </svg>
      <div className="verdict__text">
        <span className="mono-font">Judge verdict</span>
        <strong className="verdict__stamp">{label}</strong>
        <small className="mono-font">after weighing both cases · rationale is not stored separately</small>
      </div>
    </div>
  );
}

/** Recomputes nothing on chain: it looks for a PositionOpened whose cardHash equals the hash computed above. */
function OnChainMatch({ hash, fallbackTx }: { hash: string; fallbackTx?: string }) {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const match = snapshot?.positions.find((position) => position.cardHash.toLowerCase() === hash.toLowerCase());

  if (match) {
    return (
      <Reveal className="chain-match-reveal"><div className="chain-match">
        <div className="seal">
          <svg className="seal__icon" viewBox="0 0 48 48" aria-hidden="true">
            <circle className="seal__circle" cx={24} cy={24} r={20} />
            <path className="seal__check" d="m14 25 7 7 14-16" />
          </svg>
          <div>
            <p className="chain-match__ok mono-font">Verified on Sepolia · {match.attestation}</p>
            <p className="seal__sub mono-font">computed card hash = PositionOpened.cardHash</p>
          </div>
        </div>
        <p className="mono-font chain-match__meta">
          {match.settled ? `Settled at ${match.pnlBps! > 0 ? "+" : ""}${match.pnlBps} bps` : "Position open"} · block {match.openedBlock.toLocaleString("en-US")}
        </p>
        <div className="chain-match__links">
          <a className="external-link" href={etherscanTx(match.openTx)} target="_blank" rel="noreferrer">Open tx {shortHash(match.openTx)} ↗</a>
          {match.settleTx && <a className="external-link" href={etherscanTx(match.settleTx)} target="_blank" rel="noreferrer">Settle tx {shortHash(match.settleTx)} ↗</a>}
        </div>
      </div></Reveal>
    );
  }
  if (fallbackTx) return <a className="external-link" href={etherscanTx(fallbackTx)} target="_blank" rel="noreferrer">View transaction on Etherscan ↗</a>;
  if (ledger.status === "loading") return <p className="placeholder-state">Checking Sepolia for this hash…</p>;
  if (ledger.status === "unconfigured") return <p className="placeholder-state">Ledger address not configured, so the hash cannot be checked on chain.</p>;
  if (!snapshot) return <p className="placeholder-state">Could not read Sepolia to check this hash.</p>;
  return <p className="placeholder-state">No EchoLedger record carries this hash. This card has not been written on chain.</p>;
}

export function ReasoningCardDetail({ card, fixture = false }: { card: FixtureCard; fixture?: boolean }) {
  const hash = cardHash(card);
  const score = card.convergence?.score ?? 0;
  const scorePercent = Math.min(100, Math.max(0, score * 100));
  const independentKols = card.convergence?.independent_kols ?? 0;
  const verdict = card.debate?.verdict ?? "HOLD";
  const decisionLabel = verdict === "HOLD" ? "CONSTRAIN" : verdict;
  const decisionTone = verdict === "APPROVE" ? "approve" : verdict === "REJECT" ? "reject" : "constrain";
  const evidence = card.evidence;
  const risk = card.risk_rules;
  const consensusPrices = evidence?.consensus_prices;
  const transactionHash = card.tx_hash;
  const openPositions = card.risk_state?.open_positions;

  const rules: Array<{ name: string; detail: string; state: RuleState }> = [
    {
      name: "Narrative lead",
      detail: evidence?.lead_min == null ? "Lead time not supplied" : `${evidence.lead_min} min (must lead price)`,
      state: evidence?.lead_min == null ? "pending" : evidence.lead_min > 0 ? "pass" : "fail",
    },
    {
      name: "Price deviation",
      detail: evidence?.price_deviation_pct == null ? "Consensus deviation limit/result not supplied" : `${evidence.price_deviation_pct.toFixed(2)}% consensus deviation`,
      state: "pending",
    },
    {
      name: "Minimum market cap",
      detail: evidence?.market_cap_usd == null ? `Observed value missing · limit ${formatUsd(risk.min_mcap_usd)}` : `${formatUsd(evidence.market_cap_usd)} · limit ${formatUsd(risk.min_mcap_usd)}`,
      state: evidence?.market_cap_usd == null ? "pending" : evidence.market_cap_usd >= risk.min_mcap_usd ? "pass" : "fail",
    },
    {
      name: "Maximum open positions",
      detail: openPositions == null ? `Current count missing · limit ${risk.max_open}` : `${openPositions} open · limit ${risk.max_open}`,
      state: openPositions == null ? "pending" : openPositions < risk.max_open ? "pass" : "fail",
    },
    {
      name: "Position size",
      detail: `${((card.decision?.size_pct ?? 0) * 100).toFixed(1)}% requested · ${(risk.max_position_pct * 100).toFixed(1)}% max`,
      state: (card.decision?.size_pct ?? 0) <= risk.max_position_pct ? "pass" : "fail",
    },
  ];

  return (
    <SiteLayout active="card">
      <main className="card-detail">
        <header className="card-hero">
          <div>
            <a className="back-link" href="/">← Radar</a>
            <p className="eyebrow">{fixture ? "Fixture reasoning card" : "Reasoning card"} · {card.window_h ?? "—"}h window</p>
            <div className="card-title-row">
              <span className="token-icon">{card.token.slice(0, 2)}</span>
              <h1 className="display-font">{card.token}</h1>
              <span className={`decision-badge ${decisionTone}`}>{decisionIcon(decisionTone)}{decisionLabel}</span>
            </div>
            <time dateTime={card.created_at}>{formatTimestamp(card.created_at)}</time>
          </div>
          <div className="card-id-block">
            <span>Card ID</span>
            <div><code title={card.card_id}>{shortValue(card.card_id, 18, 6)}</code><CopyButton value={card.card_id} label="card ID" /></div>
          </div>
        </header>

        <section className="panel detail-section" aria-labelledby="sources-title">
          <div className="panel-heading"><div><p className="section-kicker">Contributors</p><h2 id="sources-title">Sources</h2></div><span className="count-badge">{card.sources?.length ?? 0}</span></div>
          <div className="source-summary-strip">
            <span className="source-summary-chip indep"><i />{independentKols} independent</span>
            <span className="source-summary-chip echo"><i />{card.convergence?.echo_dropped ?? 0} echo</span>
          </div>
          <div className="source-list">
            {(card.sources ?? []).map((source) => {
              const isEcho = Boolean(source.echo_of) || source.indep < 1;
              return (
                <article className={`source-row${isEcho ? " echo" : ""}`} key={source.url || `${source.kol}-${source.posted_at}`}>
                  <div className="source-heading"><strong>@{source.kol}</strong><span className="platform">{source.platform}</span><span className={`sentiment ${source.extract.sentiment}`}>{source.extract.sentiment}</span></div>
                  <p>“{source.quote ? decodeEntities(source.quote) : "Quote unavailable"}”</p>
                  <div className="source-footer">
                    {isEcho && <span className="echo-tag">↳ Echo{source.echo_of ? ` of ${shortValue(source.echo_of, 24, 8)}` : " detected"}</span>}
                    {source.url ? <a className="external-link" href={source.url} target="_blank" rel="noreferrer">Original post ↗</a> : <span className="muted-state">Original link unavailable</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="detail-grid">
          <section className="panel detail-section" aria-labelledby="detail-convergence-title">
            <div className="panel-heading"><div><p className="section-kicker">Independent signal</p><h2 id="detail-convergence-title">Convergence</h2></div><strong className={score >= RADAR_THRESHOLD ? "detail-score hot-score" : "detail-score"}>{score.toFixed(2)}</strong></div>
            <div className="metric-body">
              <div className="convergence-track" aria-label={`${card.token} convergence ${scorePercent}%`}><span className="threshold-line" style={{ left: `${RADAR_THRESHOLD * 100}%` }} /><i className={score >= RADAR_THRESHOLD ? "above" : ""} style={{ width: `${scorePercent}%` }} /></div>
              <div className="track-scale"><span>0</span><span>threshold {RADAR_THRESHOLD.toFixed(2)}</span><span>1.0</span></div>
              <p>{independentKols} independent {independentKols === 1 ? "source agrees" : "sources agree"}; {card.convergence?.echo_dropped ?? 0} echo {(card.convergence?.echo_dropped ?? 0) === 1 ? "source was" : "sources were"} discounted.</p>
            </div>
          </section>

          <section className="panel detail-section" aria-labelledby="evidence-title">
            <div className="panel-heading"><div><p className="section-kicker">Market snapshot</p><h2 id="evidence-title">Evidence</h2></div></div>
            <dl className="stat-grid">
              <div><dt>Lead time</dt><dd>{evidence?.lead_min == null ? "—" : `${evidence.lead_min} min`}</dd></div>
              <div><dt>Pre-signal move</dt><dd>{evidence?.px_change_before_pct == null ? "—" : `${evidence.px_change_before_pct.toFixed(2)}%`}</dd></div>
              <div><dt>Volume ratio</dt><dd>{evidence?.vol_ratio == null ? "—" : `${evidence.vol_ratio.toFixed(2)}×`}</dd></div>
              <div><dt>Consensus deviation</dt><dd>{evidence?.price_deviation_pct == null ? "Not supplied" : `${evidence.price_deviation_pct.toFixed(2)}%`}</dd></div>
            </dl>
            <div className="price-sources">
              <span>Consensus sources</span>
              {consensusPrices?.length ? consensusPrices.map((price) => <code key={price.source}>{price.source} {formatUsd(price.price)}</code>) : (evidence?.price_sources ?? []).map((source) => <code key={source}>{source} · price pending</code>)}
            </div>
          </section>
        </div>

        <section className="panel detail-section" aria-labelledby="debate-title">
          <div className="panel-heading"><div><p className="section-kicker">Adversarial review</p><h2 id="debate-title">Debate</h2></div><span className="confidence">{Math.round((card.debate?.confidence ?? 0) * 100)}% confidence</span></div>
          <Reveal className="debate-reveal">
            <div className="debate-thread">
              <Bubble side="bull" text={card.debate?.bull || "Argument unavailable."} />
              <Bubble side="bear" text={card.debate?.bear || "Argument unavailable."} />
              <VerdictStamp label={decisionLabel} tone={decisionTone} confidence={card.debate?.confidence ?? 0} />
            </div>
          </Reveal>
        </section>

        <section className="panel detail-section" aria-labelledby="risk-title">
          <div className="panel-heading"><div><p className="section-kicker">Deterministic gate</p><h2 id="risk-title">Risk rules</h2></div></div>
          <div className="rule-list">{rules.map((rule) => <div className="rule-row" key={rule.name}><div><strong>{rule.name}</strong><span>{rule.detail}</span></div><Status state={rule.state} /></div>)}</div>
        </section>

        <div className="detail-grid detail-grid-bottom">
          <section className="panel detail-section" aria-labelledby="chain-title">
            <div className="panel-heading"><div><p className="section-kicker">Sepolia</p><h2 id="chain-title">On-chain reference</h2></div></div>
            <div className="reference-body"><span>Canonical card hash</span><div><code title={hash}>{shortValue(hash)}</code><CopyButton value={hash} label="card hash" /></div><OnChainMatch hash={hash} fallbackTx={transactionHash} /></div>
          </section>

          <section className="panel detail-section" aria-labelledby="models-title">
            <div className="panel-heading"><div><p className="section-kicker">Provenance</p><h2 id="models-title">Models</h2></div></div>
            <dl className="model-list"><div><dt>Extraction</dt><dd>{card.models?.extract_model ?? "Not supplied"}</dd></div><div><dt>Judge</dt><dd>{card.models?.judge_model ?? "Not supplied"}</dd></div><div><dt>Debate participants</dt><dd>{card.debate?.models?.join(" · ") || "Not supplied"}</dd></div></dl>
          </section>
        </div>
      </main>
    </SiteLayout>
  );
}

export function CardNotFound({ cardId }: { cardId: string }) {
  return <SiteLayout active="card"><main className="not-found"><p className="eyebrow">Reasoning card</p><h1 className="display-font">Card not found</h1><p>No fixture matches <code>{cardId}</code>.</p><a className="back-link" href="/">← Return to Radar</a></main></SiteLayout>;
}