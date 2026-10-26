import { useScorecardData, type EquityPoint, type ScorecardData } from "./data/scorecard";

function ScorecardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
    </svg>
  );
}

function RadarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 12 18 6M12 2v2M2 12h2M12 20v2M20 12h2" />
    </svg>
  );
}

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
  const values = [0, ...points.map((point) => point.cumulativePnlBps)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const x = (index: number) => padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - ((value - min) / range) * (height - padding * 2);
  const polyline = points.map((point, index) => `${x(index)},${y(point.cumulativePnlBps)}`).join(" ");
  const area = `${x(0)},${height - padding} ${polyline} ${x(points.length - 1)},${height - padding}`;
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
            <stop offset="0" stopColor="#35e79a" stopOpacity=".24" />
            <stop offset="1" stopColor="#35e79a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="chart-baseline" x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} />
        <polygon className="chart-area" points={area} />
        <polyline className="chart-line" points={polyline} />
        {points.map((point, index) => <circle className="chart-point" key={point.settledAt} cx={x(index)} cy={y(point.cumulativePnlBps)} r="3" />)}
      </svg>
      <div className="chart-axis"><span>{new Date(points[0].settledAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</span><span>{points.length} settlements</span><span>{new Date(finalPoint.settledAt).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</span></div>
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
              <tbody>{data.byToken.map((token) => <tr key={token.token}><td><span className={`token-icon token-${token.token.toLowerCase()}`}>{token.token.slice(0, 1)}</span><strong>{token.token}</strong></td><td>{token.count}</td><td>{token.winRate}%</td><td className={token.avgPnlBps >= 0 ? "positive" : "negative"}>{formatSignedBps(token.avgPnlBps)}</td></tr>)}</tbody>
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
      <p className="leaderboard-note">Echo calls are shown separately and do not count toward independent trust-earning calls. Trend compares the latest score with three snapshots ago.</p>
    </section>
  );
}

export function Scorecard({ data }: { data?: ScorecardData }) {
  const fetchedData = useScorecardData();
  const scorecard = data ?? fetchedData;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Echo Ledger radar"><span className="brand-mark"><ScorecardIcon /></span><span>ECHO<span>LEDGER</span></span></a>
        <nav className="desktop-nav" aria-label="Primary navigation"><a href="/"><RadarIcon />Radar</a><a className="active" href="/scorecard"><ScorecardIcon />Scorecard</a></nav>
        <div className="network-status"><span className="live-dot" /><span>Sepolia</span><b>Practice</b></div>
      </header>

      <main className="scorecard-page">
        <section className="page-heading">
          <div><p className="eyebrow"><span />Proof of performance</p><h1>System <em>Scorecard</em></h1><p>Practice results and source trust, measured call by call.</p></div>
          <div className="score-as-of"><span>Snapshot</span><strong>{formatAsOf(scorecard.asOf)}</strong><small>Mock indexed data</small></div>
        </section>
        <PortfolioScorecard data={scorecard.portfolio} />
        <KolLeaderboard kols={scorecard.kols} />
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation"><a href="/"><RadarIcon /><span>Radar</span></a><a className="active" href="/scorecard"><ScorecardIcon /><span>Scorecard</span></a></nav>
    </div>
  );
}