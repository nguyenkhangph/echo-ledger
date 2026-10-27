import { SiteLayout } from "./components/SiteChrome";
import { etherscanAddress } from "./data/ledger";
import { useScorecardData, type EquityPoint, type ScorecardData } from "./data/scorecard";

function formatSignedBps(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")} bps`;
}

function formatAsOf(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function EquityCurve({ points }: { points: EquityPoint[] }) {
  if (!points.length) return <div className="empty-chart">No settled positions yet.</div>;

  const width = 720;
  const height = 190;
  const padding = 14;
  // The curve starts flat at 0 before the first settlement, so even one settled call draws a line.
  const values = [0, ...points.map((point) => point.cumulativePnlBps)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const x = (index: number) => padding + (index / (values.length - 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - ((value - min) / range) * (height - padding * 2);
  const polyline = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `${x(0)},${height - padding} ${polyline} ${x(values.length - 1)},${height - padding}`;
  const zeroY = y(0);
  const finalPoint = points.at(-1)!;

  return (
    <div className="equity-chart">
      <div className="chart-summary">
        <span>Cumulative unweighted PnL</span>
        <strong className={finalPoint.cumulativePnlBps >= 0 ? "positive" : "negative"}>{formatSignedBps(finalPoint.cumulativePnlBps)}</strong>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative PnL ${finalPoint.cumulativePnlBps} basis points over ${points.length} settled positions`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d62b22" stopOpacity=".24" />
            <stop offset="1" stopColor="#d62b22" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-baseline" x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} />
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={polyline} />
        {points.map((point, index) => <circle className="chart-point" key={point.settledAt} cx={x(index + 1)} cy={y(point.cumulativePnlBps)} r="3" />)}
      </svg>
      <div className="chart-axis"><span>{new Date(points[0].settledAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</span><span>{points.length} {points.length === 1 ? "settlement" : "settlements"}</span><span>{new Date(finalPoint.settledAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</span></div>
    </div>
  );
}

function PortfolioScorecard({ data }: { data: ScorecardData["portfolio"] }) {
  const stats = [
    { label: "Positions opened", value: data.totalPositions.toString() },
    { label: "Currently open", value: data.openPositions.toString() },
    { label: "Closed / settled", value: data.settledPositions.toString() },
    { label: "Win rate", value: `${data.winRate}%`, tone: data.winRate >= 50 ? "positive" : "negative" },
    { label: "Average PnL", value: formatSignedBps(data.avgPnlBps), tone: data.avgPnlBps >= 0 ? "positive" : "negative" },
  ];

  return (
    <section className="scorecard-section" aria-labelledby="portfolio-title">
      <div className="score-section-heading">
        <div><p className="section-kicker">Practice portfolio</p><h2 id="portfolio-title">Performance scorecard</h2></div>
        <span className="practice-label">No real capital</span>
      </div>
      <div className="portfolio-stats">
        {stats.map((stat) => <div className="portfolio-stat" key={stat.label}><span>{stat.label}</span><strong className={stat.tone}>{stat.value}</strong></div>)}
      </div>
      <div className="portfolio-grid">
        <div className="panel curve-panel"><EquityCurve points={data.equityCurve} /></div>
        <section className="panel token-table-panel" aria-labelledby="token-breakdown-title">
          <div className="panel-heading"><div><p className="section-kicker">Settled calls</p><h2 id="token-breakdown-title">By token</h2></div></div>
          <div className="score-table-wrap">
            <table className="score-table token-score-table">
              <thead><tr><th>Token</th><th>Count</th><th>Win rate</th><th>Avg PnL</th></tr></thead>
              <tbody>{data.byToken.length === 0 && <tr><td colSpan={4} className="empty-row">No settled calls yet.</td></tr>}{data.byToken.map((token) => <tr key={token.token}><td><span className="token-icon">{token.token.slice(0, 2)}</span><strong>{token.token}</strong></td><td>{token.count}</td><td>{token.winRate}%</td><td className={token.avgPnlBps >= 0 ? "positive" : "negative"}>{formatSignedBps(token.avgPnlBps)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function KolLeaderboard({ kols }: { kols: ScorecardData["kols"] }) {
  return (
    <section className="panel leaderboard-panel" aria-labelledby="leaderboard-title">
      <div className="panel-heading leaderboard-heading">
        <div><p className="section-kicker">Independent track record</p><h2 id="leaderboard-title">KOL leaderboard</h2></div>
        <span className="count-badge">{kols.length} ranked</span>
      </div>
      <div className="score-table-wrap">
        <table className="score-table leaderboard-table">
          <thead><tr><th>Rank</th><th>Handle / channel</th><th>Trust score</th><th>Wins</th><th>Losses</th><th>Echoes</th><th>Trend</th></tr></thead>
          <tbody>
            {kols.map((kol) => {
              const trustPercent = Math.max(0, Math.min(100, kol.trustScore / 100));
              return (
                <tr key={kol.id}>
                  <td><span className={`rank-badge rank-${kol.rank}`}>{String(kol.rank).padStart(2, "0")}</span></td>
                  <td><div className="leader-identity"><strong>@{kol.handle}</strong><span><i />{kol.channel}</span></div></td>
                  <td><div className="leader-trust"><div><span>{trustPercent.toFixed(1)}%</span><small>{kol.trustScore.toLocaleString("en-US")} / 10,000</small></div><div className="trust-track"><i style={{ width: `${trustPercent}%` }} /></div></div></td>
                  <td className="positive">{kol.winCalls}</td>
                  <td className="negative">{kol.lossCalls}</td>
                  <td><span className="echo-count">{kol.echoCalls}</span></td>
                  <td><span className={`trend trend-${kol.trend}`} aria-label={`${kol.trend} ${Math.abs(kol.trendDelta)} trust points`}><b>{kol.trend === "up" ? "↑" : kol.trend === "down" ? "↓" : "→"}</b>{kol.trendDelta > 0 ? "+" : ""}{kol.trendDelta}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {kols.length === 0 && <p className="empty-row">No trust updates recorded yet.</p>}
      <p className="leaderboard-note">Echo calls are shown separately and do not count toward independent trust-earning calls. Trend compares the latest score with the one before it (every source starts at 5,000).</p>
    </section>
  );
}

export function Scorecard({ data }: { data?: ScorecardData }) {
  const fetchedData = useScorecardData();
  const scorecard = data ?? fetchedData;

  return (
    <SiteLayout active="scorecard">
      <main className="scorecard-page">
        <section className="page-heading">
          <div><p className="eyebrow">Proof of performance</p><h1 className="display-font">System <span className="accent-underline">Scorecard</span></h1><p>Practice results and source trust, measured call by call.</p></div>
          <div className="score-as-of">
            <span>{scorecard.source.kind === "live" ? "Live · Ethereum Sepolia" : "Sample data"}</span>
            <strong>{formatAsOf(scorecard.asOf)}</strong>
            {scorecard.source.kind === "live" ? (
              <a href={etherscanAddress(scorecard.source.address)} target="_blank" rel="noreferrer">Block {scorecard.source.block.toLocaleString("en-US")} ↗</a>
            ) : (
              <small>{scorecard.source.reason}</small>
            )}
          </div>
        </section>
        <PortfolioScorecard data={scorecard.portfolio} />
        <KolLeaderboard kols={scorecard.kols} />
      </main>
    </SiteLayout>
  );
}