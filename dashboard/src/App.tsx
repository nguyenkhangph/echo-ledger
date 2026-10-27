import { exampleCards } from "@echo/shared/fixtures";
import type { ReasoningCard } from "@echo/shared/card";
import { CardNotFound, ReasoningCardDetail } from "./ReasoningCardDetail";
import { Scorecard } from "./Scorecard";
import { OnChainLedger } from "./components/OnChainLedger";
import { EclipseOrb, Reveal, SectionHeading, SiteLayout } from "./components/SiteChrome";

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

const newestCards = [...exampleCards].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const approvedCount = exampleCards.filter((card) => card.debate?.verdict === "APPROVE").length;
const echoDropped = exampleCards.reduce((total, card) => total + (card.convergence?.echo_dropped ?? 0), 0);

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

function verdictLabel(card: ReasoningCard) {
  const verdict = card.debate?.verdict ?? "HOLD";
  return verdict === "HOLD" ? "CONSTRAIN" : verdict;
}

function HeroStat({ label, value, live = false }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="hero-stat">
      <p className="mono-font">
        {live && <span className="live-dot" aria-hidden="true" />}
        {value}
      </p>
      <span>{label}</span>
    </div>
  );
}

function LatestCards() {
  return (
    <div className="hero-panel">
      <div className="hero-panel__head">
        <p className="mono-font"><span className="live-dot" aria-hidden="true" />Latest reasoning cards</p>
        <span className="mono-font">Ethereum Sepolia</span>
      </div>
      <ul>
        {newestCards.map((card, index) => (
          <li key={card.card_id} className="pop-in" style={{ animationDelay: `${index * 70}ms` }}>
            <a className={`launch-row${index === 0 ? " launch-row--latest" : ""}`} href={`/card/${encodeURIComponent(card.card_id)}`}>
              <span className="mono-font launch-row__index">#{newestCards.length - index}</span>
              <span className="token-icon">{card.token.slice(0, 2)}</span>
              <span className="launch-row__body">
                <strong>{card.token}</strong>
                <span className="mono-font">
                  {verdictLabel(card)} · score {card.convergence.score.toFixed(2)} · {card.convergence.independent_kols} independent
                </span>
              </span>
              <span className="launch-row__arrow" aria-hidden="true">→</span>
            </a>
          </li>
        ))}
      </ul>
      <a href="#radar" className="hero-panel__foot mono-font">
        Open live radar <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

// One pass of the ticker has to be wider than any screen, or a gap shows
// before the loop restarts, so short feeds are repeated to at least 12 items.
const TICKER_MIN_ITEMS = 12;

function SignalTicker() {
  if (feed.length === 0) return null;
  const pass = Array.from({ length: Math.ceil(TICKER_MIN_ITEMS / feed.length) }, () => feed).flat();
  const loop = [...pass, ...pass];
  return (
    <div className="ticker" aria-label="Latest signals">
      <div className="ticker__track mono-font">
        {loop.map((item, index) => (
          <a
            key={`${item.url}-${index}`}
            href={`/card/${encodeURIComponent(item.cardId)}`}
            aria-hidden={index >= feed.length ? true : undefined}
            tabIndex={index >= feed.length ? -1 : undefined}
          >
            <span className="ticker__dot" aria-hidden="true" />
            <strong>@{item.kol}</strong>
            <span>${item.token}</span>
            <span>{item.isEcho ? "echo" : item.extract.sentiment}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Ingest public voices", body: "Telegram channels and X accounts on the watchlist are read every cycle. Paid promotions are flagged and set aside, not hidden." },
  { title: "Discount the echoes", body: "Calls that quote or repeat an earlier call are folded into it. Only independent voices count toward convergence." },
  { title: "Debate before acting", body: "A bull, a bear and a judge argue the evidence. Deterministic risk rules sit after the verdict, not inside it." },
  { title: "Write the proof on-chain", body: "Every decision becomes a reasoning card. Its hash is recorded by a Chainlink CRE workflow on Sepolia." },
];

function HowItWorks() {
  return (
    <section className="page-section" aria-labelledby="steps-title">
      <Reveal>
        <SectionHeading id="steps-title" eyebrow="How it works" title="Four stages, one auditable trail" />
      </Reveal>
      <div role="list" className="steps">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={index * 90} className="step">
            <div role="listitem">
              <span className="mono-font step__index">0{index + 1}</span>
              <span className="step__line" aria-hidden="true" />
              <h3>{step.title}</h3>
              <p className="mono-font">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Radar() {
  const latest = newestCards[0];
  return (
    <SiteLayout active="radar">
      <section className="hero">
        <EclipseOrb className="hero__orb" />
        <div className="hero__grid">
          <div>
            <p className="eyebrow fade-up">Narrative convergence · Ethereum Sepolia</p>
            <h1 className="display-font fade-up" style={{ ["--d" as string]: "80ms" }}>
              Filter the echo.
              <br />
              Record the <span className="accent-underline">signal</span>
            </h1>
            <p className="mono-font hero__lead fade-up" style={{ ["--d" as string]: "160ms" }}>
              Echo Ledger watches crypto voices, folds repeated calls into the one they echo, debates what is left, and writes every decision's
              hash on-chain.
            </p>
            <div className="hero__actions fade-up" style={{ ["--d" as string]: "240ms" }}>
              {latest && (
                <a className="ec-button" href={`/card/${encodeURIComponent(latest.card_id)}`}>
                  Open latest card <span aria-hidden="true">→</span>
                </a>
              )}
              <a className="ghost-button" href="/scorecard">View scorecard</a>
            </div>
            <div className="hero__stats fade-up" style={{ ["--d" as string]: "320ms" }}>
              <HeroStat live label="Voices monitored" value={String(watchlist.length)} />
              <HeroStat label="Reasoning cards" value={String(exampleCards.length)} />
              <HeroStat label="Approved" value={String(approvedCount)} />
              <HeroStat label="Echoes discounted" value={String(echoDropped)} />
            </div>
          </div>
          <div className="fade-up hero__panel-wrap" style={{ ["--d" as string]: "200ms" }}>
            <LatestCards />
          </div>
        </div>
      </section>

      <SignalTicker />

      <section className="page-section" id="radar" aria-labelledby="radar-title">
        <Reveal>
          <div className="section-heading-row">
            <SectionHeading id="radar-title" eyebrow="Live radar" title="Independent voices, measured before the market moves" />
            <div className="scan-status" aria-label="Live scan status">
              <span className="live-dot" aria-hidden="true" />
              <span className="mono-font">Live scan · {watchlist.length} voices</span>
            </div>
          </div>
        </Reveal>

        <div className="dashboard-grid">
          <Reveal className="panel watchlist-panel">
            <section aria-labelledby="watchlist-title">
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
                {watchlist.map((kol) => (
                  <article className="kol-row" key={kol.name}>
                    <div className="avatar">{kol.initials}</div>
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
                        <i className="bar-shimmer" style={{ width: `${kol.trust}%` }} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <p className="mock-note">Trust is estimated from fixture independence and conviction.</p>
            </section>
          </Reveal>

          <Reveal className="panel convergence-panel" delay={90}>
            <section aria-labelledby="convergence-title">
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
                    <a className="token-signal" key={card.card_id} href={`/card/${encodeURIComponent(card.card_id)}`}>
                      <div className="token-summary">
                        <span className="token-icon">{card.token.slice(0, 2)}</span>
                        <div><strong>{card.token}</strong><small>{card.convergence.independent_kols} independent {card.convergence.independent_kols === 1 ? "voice" : "voices"}</small></div>
                        <b className={aboveThreshold ? "hot-score" : ""}>{card.convergence.score.toFixed(2)}</b>
                      </div>
                      <div className="convergence-track" aria-label={`${card.token} convergence ${percent}%`}>
                        <span className="threshold-line" style={{ left: `${RADAR_THRESHOLD * 100}%` }} />
                        <i className={`bar-shimmer${aboveThreshold ? " above" : ""}`} style={{ width: `${percent}%` }} />
                      </div>
                      <div className="track-scale"><span>0</span><span>signal strength</span><span>1.0</span></div>
                    </a>
                  );
                })}
              </div>
            </section>
          </Reveal>

          <Reveal className="panel feed-panel" delay={120}>
            <section aria-labelledby="feed-title">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Incoming</p>
                  <h2 id="feed-title">Event Feed</h2>
                </div>
                <span className="streaming"><i className="live-dot" /> streaming</span>
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
          </Reveal>
        </div>
      </section>

      <OnChainLedger />

      <HowItWorks />
    </SiteLayout>
  );
}

function App() {
  if (typeof window !== "undefined" && /^\/scorecard\/?$/.test(window.location.pathname)) {
    return <Scorecard />;
  }

  const cardRoute = typeof window === "undefined" ? null : window.location.pathname.match(/^\/card\/([^/]+)\/?$/);
  if (cardRoute) {
    const cardId = decodeURIComponent(cardRoute[1]);
    const card = exampleCards.find((candidate) => candidate.card_id === cardId);
    return card ? <ReasoningCardDetail card={card} /> : <CardNotFound cardId={cardId} />;
  }

  return <Radar />;
}

export default App;
