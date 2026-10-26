import { exampleCards } from "@echo/shared/fixtures";
import type { ReasoningCard } from "@echo/shared/card";
import { CardNotFound, ReasoningCardDetail } from "./ReasoningCardDetail";

const RADAR_THRESHOLD = 0.6;
const snapshotTime = new Date(
  Math.max(...exampleCards.map((card) => Date.parse(card.created_at))),
);

type CardSource = ReasoningCard["sources"][number];
type Sentiment = CardSource["extract"]["sentiment"];

type FeedItem = CardSource & {
  cardId: string;
  token: string;
  isEcho: boolean;
};

type KolProfile = {
  name: string;
  initials: string;
  token: string;
  sentiment: Sentiment;
  trust: number;
};

function initialsFor(name: string) {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const feed: FeedItem[] = exampleCards
  .flatMap((card) =>
    card.sources.map((source) => ({
      ...source,
      cardId: card.card_id,
      token: card.token,
      isEcho: Boolean(source.echo_of) || source.indep < 1,
    })),
  )
  .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));

const watchlist: KolProfile[] = feed.map((source) => ({
  name: source.kol,
  initials: initialsFor(source.kol),
  token: source.token,
  sentiment: source.extract.sentiment,
  // Temporary mock trust until agent reputation is available.
  trust: Math.round((source.indep * 0.55 + source.extract.conviction * 0.45) * 100),
}));

function formatRelativeTime(date: string) {
  const diffMinutes = Math.max(
    0,
    Math.round((snapshotTime.getTime() - Date.parse(date)) / 60_000),
  );

  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
}

function SignalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17V7m5 13V4m6 13V7m5 13V4" />
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

function LedgerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6a8 8 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.1l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.5.9l.3 2.6h4L15 18a8 8 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1.1Z" />
    </svg>
  );
}

function App() {
  const cardRoute = typeof window === "undefined" ? null : window.location.pathname.match(/^\/card\/([^/]+)\/?$/);
  if (cardRoute) {
    const cardId = decodeURIComponent(cardRoute[1]);
    const card = exampleCards.find((candidate) => candidate.card_id === cardId);
    return card ? <ReasoningCardDetail card={card} /> : <CardNotFound cardId={cardId} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Echo Ledger home">
          <span className="brand-mark"><SignalIcon /></span>
          <span>ECHO<span>LEDGER</span></span>
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <a className="active" href="#radar"><RadarIcon />Radar</a>
          <a href="#ledger"><LedgerIcon />Ledger</a>
          <a href="#settings"><SettingsIcon />Settings</a>
        </nav>

        <div className="network-status">
          <span className="live-dot" />
          <span>Sepolia</span>
          <b>Practice</b>
        </div>
      </header>

      <main id="top">
        <section className="page-heading" id="radar">
          <div>
            <p className="eyebrow"><span />Intelligence feed</p>
            <h1>Narrative <em>Radar</em></h1>
            <p>Tracking independent voices before the market moves.</p>
          </div>
          <div className="scan-status" aria-label="Live scan status">
            <span className="scan-pulse"><RadarIcon /></span>
            <span><b>Live scan</b><small>{watchlist.length} voices monitored</small></span>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="panel watchlist-panel" aria-labelledby="watchlist-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Signal sources</p>
                <h2 id="watchlist-title">KOL Watchlist</h2>
              </div>
              <span className="count-badge">{watchlist.length}</span>
            </div>

            <div className="watchlist-labels" aria-hidden="true">
              <span>Voice</span><span>Last signal</span><span>Trust</span>
            </div>
            <div className="watchlist-rows">
              {watchlist.map((kol, index) => (
                <article className="kol-row" key={kol.name}>
                  <div className={`avatar avatar-${index % 4}`}>{kol.initials}</div>
                  <div className="kol-identity">
                    <strong>@{kol.name}</strong>
                    <span><i className="platform-dot" /> monitored</span>
                  </div>
                  <div className="last-signal">
                    <span className={`sentiment ${kol.sentiment}`}>{kol.sentiment}</span>
                    <b>{kol.token}</b>
                  </div>
                  <div className="trust-cell">
                    <span>{kol.trust}%</span>
                    <div className="trust-track" aria-label={`${kol.trust}% trust`}>
                      <i style={{ width: `${kol.trust}%` }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="mock-note">Trust is estimated from fixture independence and conviction.</p>
          </section>

          <section className="panel convergence-panel" aria-labelledby="convergence-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Last 6 hours</p>
                <h2 id="convergence-title">Convergence</h2>
              </div>
              <span className="legend"><i /> threshold {RADAR_THRESHOLD.toFixed(2)}</span>
            </div>

            <div className="convergence-list">
              {exampleCards.map((card) => {
                const percent = Math.max(0, card.convergence.score * 100);
                const aboveThreshold = card.convergence.score >= RADAR_THRESHOLD;
                return (
                  <article className="token-signal" key={card.card_id}>
                    <div className="token-summary">
                      <span className={`token-icon token-${card.token.toLowerCase()}`}>
                        {card.token.slice(0, 1)}
                      </span>
                      <div><strong>{card.token}</strong><small>{card.convergence.independent_kols} independent {card.convergence.independent_kols === 1 ? "voice" : "voices"}</small></div>
                      <b className={aboveThreshold ? "hot-score" : ""}>{card.convergence.score.toFixed(2)}</b>
                    </div>
                    <div className="convergence-track" aria-label={`${card.token} convergence ${percent}%`}>
                      <span className="threshold-line" style={{ left: `${RADAR_THRESHOLD * 100}%` }} />
                      <i className={aboveThreshold ? "above" : ""} style={{ width: `${percent}%` }} />
                    </div>
                    <div className="track-scale"><span>0</span><span>signal strength</span><span>1.0</span></div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel feed-panel" aria-labelledby="feed-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Incoming</p>
                <h2 id="feed-title">Event Feed</h2>
              </div>
              <span className="streaming"><i /> streaming</span>
            </div>

            <div className="feed-list">
              {feed.map((item) => (
                <a className={`feed-item${item.isEcho ? " echo" : ""}`} key={item.url} href={`/card/${encodeURIComponent(item.cardId)}`} aria-label={`Open ${item.token} reasoning card`}>
                  <div className="feed-line" aria-hidden="true"><i /></div>
                  <div className="feed-content">
                    <div className="feed-meta">
                      <strong>@{item.kol}</strong>
                      <span className="platform">{item.platform}</span>
                      <time dateTime={item.posted_at}>{formatRelativeTime(item.posted_at)}</time>
                    </div>
                    <p>“{item.quote}”</p>
                    <div className="feed-tags">
                      <span className="token-tag">{item.token}</span>
                      <span className={`sentiment ${item.extract.sentiment}`}>{item.extract.sentiment}</span>
                      {item.isEcho && <span className="echo-tag">↳ Echo detected</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <a className="active" href="#radar"><RadarIcon /><span>Radar</span></a>
        <a href="#ledger"><LedgerIcon /><span>Ledger</span></a>
        <a href="#settings"><SettingsIcon /><span>Settings</span></a>
      </nav>
    </div>
  );
}

export default App;