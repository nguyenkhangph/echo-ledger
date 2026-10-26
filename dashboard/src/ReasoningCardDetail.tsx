import { useState } from "react";
import type { ReasoningCard } from "@echo/shared/card";
import { cardHash } from "@echo/shared/hash";

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

function Status({ state }: { state: RuleState }) {
  return <span className={`rule-status ${state}`}>{state === "pending" ? "Pending data" : state}</span>;
}

export function ReasoningCardDetail({ card }: { card: FixtureCard }) {
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
    <div className="app-shell">
      <header className="topbar detail-topbar">
        <a className="brand" href="/" aria-label="Echo Ledger radar">
          <span className="brand-mark" aria-hidden="true">EL</span>
          <span>ECHO<span>LEDGER</span></span>
        </a>
        <a className="back-link" href="/">← Radar</a>
        <div className="network-status"><span className="live-dot" /><span>Sepolia</span><b>Practice</b></div>
      </header>

      <main className="card-detail">
        <header className="card-hero">
          <div>
            <p className="eyebrow"><span />Reasoning card · {card.window_h ?? "—"}h window</p>
            <div className="card-title-row">
              <span className={`token-icon token-${card.token.toLowerCase()}`}>{card.token.slice(0, 1)}</span>
              <h1>{card.token}</h1>
              <span className={`decision-badge ${decisionTone}`}>{decisionLabel}</span>
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
          <div className="source-list">
            {(card.sources ?? []).map((source) => {
              const isEcho = Boolean(source.echo_of) || source.indep < 1;
              return (
                <article className={`source-row${isEcho ? " echo" : ""}`} key={source.url || `${source.kol}-${source.posted_at}`}>
                  <div className="source-heading"><strong>@{source.kol}</strong><span className="platform">{source.platform}</span><span className={`sentiment ${source.extract.sentiment}`}>{source.extract.sentiment}</span></div>
                  <p>“{source.quote || "Quote unavailable"}”</p>
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
          <div className="debate-grid">
            <article className="debate-block bull"><span>Bull</span><p>{card.debate?.bull || "Argument unavailable."}</p></article>
            <article className="debate-block bear"><span>Bear</span><p>{card.debate?.bear || "Argument unavailable."}</p></article>
            <article className="debate-block judge"><span>Judge · {decisionLabel}</span><p>The judge selected <strong>{verdict}</strong> after weighing the bull and bear cases at {Math.round((card.debate?.confidence ?? 0) * 100)}% confidence. The fixture does not yet provide a separate judge reasoning field.</p></article>
          </div>
        </section>

        <section className="panel detail-section" aria-labelledby="risk-title">
          <div className="panel-heading"><div><p className="section-kicker">Deterministic gate</p><h2 id="risk-title">Risk rules</h2></div></div>
          <div className="rule-list">{rules.map((rule) => <div className="rule-row" key={rule.name}><div><strong>{rule.name}</strong><span>{rule.detail}</span></div><Status state={rule.state} /></div>)}</div>
        </section>

        <div className="detail-grid detail-grid-bottom">
          <section className="panel detail-section" aria-labelledby="chain-title">
            <div className="panel-heading"><div><p className="section-kicker">Sepolia</p><h2 id="chain-title">On-chain reference</h2></div></div>
            <div className="reference-body"><span>Canonical card hash</span><div><code title={hash}>{shortValue(hash)}</code><CopyButton value={hash} label="card hash" /></div>{transactionHash ? <a className="external-link" href={`https://sepolia.etherscan.io/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction on Etherscan ↗</a> : <p className="placeholder-state">Transaction pending — no Sepolia transaction hash in fixture.</p>}</div>
          </section>

          <section className="panel detail-section" aria-labelledby="models-title">
            <div className="panel-heading"><div><p className="section-kicker">Provenance</p><h2 id="models-title">Models</h2></div></div>
            <dl className="model-list"><div><dt>Extraction</dt><dd>{card.models?.extract_model ?? "Not supplied"}</dd></div><div><dt>Judge</dt><dd>{card.models?.judge_model ?? "Not supplied"}</dd></div><div><dt>Debate participants</dt><dd>{card.debate?.models?.join(" · ") || "Not supplied"}</dd></div></dl>
          </section>
        </div>
      </main>
    </div>
  );
}

export function CardNotFound({ cardId }: { cardId: string }) {
  return <main className="not-found"><p className="eyebrow"><span />Reasoning card</p><h1>Card not found</h1><p>No fixture matches <code>{cardId}</code>.</p><a className="back-link" href="/">← Return to Radar</a></main>;
}