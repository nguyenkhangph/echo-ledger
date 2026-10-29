import { useState } from "react";
import { decodeEntities, narratives, postById, relativeTime, type Narrative } from "../data/pipeline";

const THRESHOLD = 0.6;
const W = 760;
const H = 520;
const CX = W / 2;
const CY = H / 2;
const INNER = { rx: 226, ry: 132 };
const OUTER = { rx: 330, ry: 206 };
const HUB_R = 46;
const RING_R = 57;
const RING_LEN = 2 * Math.PI * RING_R;

type Source = Narrative["sources"][number];
type Kind = "agree" | "oppose" | "echo";
type GraphNode = { key: string; source: Source; kind: Kind; x: number; y: number; origin?: { name: string; x: number; y: number } };

const onEllipse = (angle: number, e: { rx: number; ry: number }) => ({ x: CX + Math.cos(angle) * e.rx, y: CY + Math.sin(angle) * e.ry });
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const initials = (handle: string) => handle.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
const sentimentWord = (sentiment: string) => (sentiment === "bullish" ? "bull" : sentiment === "bearish" ? "bear" : "flat");

function analyze(narrative: Narrative) {
  const independent = narrative.sources.filter((source) => !source.is_echo);
  const counts = new Map<string, number>();
  for (const source of independent) counts.set(source.sentiment, (counts.get(source.sentiment) ?? 0) + 1);
  const direction = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";
  const ordered: Array<{ source: Source; kind: Kind }> = [
    ...independent.filter((source) => source.sentiment === direction).map((source) => ({ source, kind: "agree" as const })),
    ...independent.filter((source) => source.sentiment !== direction).map((source) => ({ source, kind: "oppose" as const })),
    ...narrative.sources.filter((source) => source.is_echo).map((source) => ({ source, kind: "echo" as const })),
  ];
  const total = ordered.length;
  const origins = new Map<string, { x: number; y: number }>();
  const nodes: GraphNode[] = ordered.map(({ source, kind }, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(total, 1) + (total === 1 ? 0 : Math.PI / total);
    const inner = onEllipse(angle, INNER);
    let origin: GraphNode["origin"];
    if (kind === "echo") {
      const name = source.echo_of ?? "earlier post";
      if (!origins.has(name)) origins.set(name, onEllipse(angle, OUTER));
      origin = { name, ...origins.get(name)! };
    }
    return { key: source.post_id, source, kind, x: inner.x, y: inner.y, origin };
  });
  return { direction, nodes };
}

function summaryFor(narrative: Narrative, direction: string) {
  const { convergence } = narrative;
  const verdict = convergence.passed
    ? "passes and goes to the debate"
    : convergence.independent_count < 2
      ? "needs at least 2 independent voices"
      : `stays under the ${THRESHOLD.toFixed(2)} bar`;
  const echoes = convergence.echo_count ? `${convergence.echo_count} echo discounted` : "no echoes";
  return `${convergence.agreeing_independent_count} of ${convergence.independent_count} independent voices say ${direction} · ${echoes} · score ${convergence.score.toFixed(2)}, ${verdict}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function Detail({ node }: { node: GraphNode }) {
  const post = postById.get(node.source.post_id);
  const handle = node.source.handle.startsWith("@") ? node.source.handle : `@${node.source.handle}`;
  const text = post ? decodeEntities(post.text) : null;
  return (
    <div className="eg-detail__body">
      <div className="eg-detail__head">
        <strong>{handle}</strong>
        {post && <span className="mono-font">{post.platform} · {relativeTime(post.posted_at)}</span>}
        <span className={`sentiment ${node.source.sentiment === "bullish" ? "bull" : node.source.sentiment === "bearish" ? "bear" : "neutral"}`}>{node.source.sentiment}</span>
        <span className="token-tag">conviction {node.source.conviction.toFixed(1)}</span>
        {node.kind === "echo" ? (
          <span className="echo-tag">↳ echo of {node.source.echo_of ?? "an earlier post"} · counts 0</span>
        ) : (
          <span className="token-tag">independent · counts 1</span>
        )}
      </div>
      {text && <p className="mono-font">“{clip(text, 260)}”</p>}
      {post && (
        <a className="tx-link" href={post.url} target="_blank" rel="noreferrer">Open original post ↗</a>
      )}
    </div>
  );
}

export function EchoGraph() {
  const defaultIndex = Math.max(0, narratives.findIndex((narrative) => narrative.convergence.echo_count > 0));
  const [selected, setSelected] = useState(defaultIndex);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const narrative = narratives[selected];

  if (!narrative) {
    return <p className="ledger-empty mono-font">No convergence candidate yet. The graph appears after the first agent cycle.</p>;
  }

  const { direction, nodes } = analyze(narrative);
  const score = Math.min(1, Math.max(0, narrative.convergence.score));
  const tickAngle = -Math.PI / 2 + THRESHOLD * 2 * Math.PI;
  const tick = (r: number) => ({ x: CX + Math.cos(tickAngle) * r, y: CY + Math.sin(tickAngle) * r });
  const activeKey = hover ?? pinned;
  const active = nodes.find((node) => node.key === activeKey);
  const choose = (index: number) => {
    setSelected(index);
    setPinned(null);
    setHover(null);
  };

  return (
    <section aria-labelledby="echo-graph-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Narrative graph · who said it, who only repeated it</p>
          <h2 id="echo-graph-title">Echo Graph</h2>
        </div>
        <ul className="eg-legend mono-font" aria-label="Legend">
          <li><i className="eg-key eg-key--agree" />independent, agrees</li>
          <li><i className="eg-key eg-key--oppose" />independent, disagrees</li>
          <li><i className="eg-key eg-key--echo" />echo, counts 0</li>
        </ul>
      </div>

      <div className="eg-body">
        <div className="eg-tabs" role="tablist" aria-label="Narratives">
          {narratives.map((item, index) => {
            const flagged = item.convergence.echo_count > 0;
            return (
              <button
                key={`${item.date}-${item.token}-${index}`}
                type="button"
                role="tab"
                aria-selected={index === selected}
                className={`eg-tab${index === selected ? " is-active" : ""}`}
                onClick={() => choose(index)}
              >
                <span className="token-icon">{item.token.slice(0, 2)}</span>
                <span className="eg-tab__text">
                  <strong>{item.token}</strong>
                  <small className="mono-font">{formatDate(item.date)} · {item.convergence.score.toFixed(2)}</small>
                </span>
                {item.convergence.passed && <em className="row-tag row-tag--chain">passed</em>}
                {flagged && <em className="row-tag row-tag--echo">{item.convergence.echo_count} echo</em>}
              </button>
            );
          })}
        </div>

        <div className="eg-stage">
          <svg
            key={`${narrative.date}-${narrative.token}-${selected}`}
            className="eg-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${narrative.token} narrative: ${summaryFor(narrative, direction)}`}
          >
            <ellipse className="eg-orbit" cx={CX} cy={CY} rx={INNER.rx} ry={INNER.ry} />
            <ellipse className="eg-orbit eg-orbit--outer" cx={CX} cy={CY} rx={OUTER.rx} ry={OUTER.ry} />

            {nodes.map((node, index) => {
              const delay = `${160 + index * 110}ms`;
              const width = 1 + node.source.conviction * 2.2;
              return (
                <g key={`link-${node.key}`}>
                  {node.kind === "echo" && node.origin ? (
                    <>
                      <line className="eg-link eg-link--ghost" x1={node.x} y1={node.y} x2={CX} y2={CY} style={{ animationDelay: delay }} />
                      <line className="eg-link eg-link--echo" x1={node.x} y1={node.y} x2={node.origin.x} y2={node.origin.y} style={{ animationDelay: delay }} />
                    </>
                  ) : (
                    <line
                      className={`eg-link eg-link--${node.kind}`}
                      x1={node.x}
                      y1={node.y}
                      x2={CX}
                      y2={CY}
                      pathLength={1}
                      strokeWidth={width}
                      style={{ animationDelay: delay }}
                    />
                  )}
                </g>
              );
            })}

            {[...new Map(nodes.filter((node) => node.origin).map((node) => [node.origin!.name, node.origin!])).values()].map((origin, index) => (
              <g key={`origin-${origin.name}`} transform={`translate(${origin.x} ${origin.y})`}>
                <g className="eg-pop" style={{ animationDelay: `${500 + index * 110}ms` }}>
                  <circle className="eg-origin" r={17} />
                  <circle className="eg-origin-dot" r={3} />
                  <text className="eg-label eg-label--echo" y={origin.y < CY ? -36 : 36} textAnchor="middle">{clip(origin.name, 22)}</text>
                  <text className="eg-sub" y={origin.y < CY ? -24 : 49} textAnchor="middle">original source</text>
                </g>
              </g>
            ))}

            <g className="eg-hub">
              <circle className="eg-ring-bg" cx={CX} cy={CY} r={RING_R} />
              <circle
                className={`eg-ring${narrative.convergence.passed ? " is-passed" : ""}`}
                cx={CX}
                cy={CY}
                r={RING_R}
                transform={`rotate(-90 ${CX} ${CY})`}
                style={{ ["--s" as string]: `${score * RING_LEN}px`, ["--c" as string]: `${RING_LEN}px` }}
              />
              <line className="eg-tick" x1={tick(RING_R - 6).x} y1={tick(RING_R - 6).y} x2={tick(RING_R + 8).x} y2={tick(RING_R + 8).y} />
              <circle className={`eg-core${narrative.convergence.passed ? " is-passed" : ""}`} cx={CX} cy={CY} r={HUB_R} />
              <text className="eg-token" x={CX} y={CY - 2} textAnchor="middle">{narrative.token}</text>
              <text className="eg-score" x={CX} y={CY + 16} textAnchor="middle">{narrative.convergence.score.toFixed(2)}{narrative.convergence.passed ? " passed" : ""}</text>
            </g>

            {nodes.map((node, index) => {
              const isActive = node.key === activeKey;
              return (
                <g
                  key={node.key}
                  className={`eg-node eg-node--${node.kind}${isActive ? " is-active" : ""}`}
                  transform={`translate(${node.x} ${node.y})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.source.handle}, ${node.source.sentiment}, ${node.kind === "echo" ? "echo" : "independent"}`}
                  onMouseEnter={() => setHover(node.key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(node.key)}
                  onBlur={() => setHover(null)}
                  onClick={() => setPinned((current) => (current === node.key ? null : node.key))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setPinned((current) => (current === node.key ? null : node.key));
                    }
                  }}
                >
                  <g className="eg-pop" style={{ animationDelay: `${300 + index * 110}ms` }}>
                    <rect className="eg-box" x={-21} y={-21} width={42} height={42} rx={2} />
                    <text className="eg-init" y={4} textAnchor="middle">{initials(node.source.handle)}</text>
                    <text className="eg-label" y={39} textAnchor="middle">{clip(node.source.handle, 18)}</text>
                    <text className={`eg-sub${node.kind === "echo" ? " eg-sub--echo" : ""}`} y={52} textAnchor="middle">
                      {node.kind === "echo" ? "echo · ×0" : sentimentWord(node.source.sentiment)}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          <div className="eg-detail" aria-live="polite">
            {active ? <Detail node={active} /> : <p className="eg-summary mono-font">{summaryFor(narrative, direction)}</p>}
            {!active && <p className="eg-hint mono-font">Hover or tap a node to read the post. Dashed amber lines point back to the voice an echo only repeated.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
