const W = 64;
const H = 22;

/** Trust history for one source: the 50% seed followed by every on-chain TrustUpdated score (basis points). */
export function TrustSpark({ series }: { series: number[] }) {
  if (series.length < 2) {
    return (
      <svg className="spark spark--empty" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <line x1={2} y1={H / 2} x2={W - 2} y2={H / 2} />
      </svg>
    );
  }
  const lo = Math.min(...series, 4500);
  const hi = Math.max(...series, 5500);
  const x = (index: number) => 3 + (index / (series.length - 1)) * (W - 8);
  const y = (value: number) => H - 4 - ((value - lo) / (hi - lo)) * (H - 8);
  const points = series.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const net = series[series.length - 1]! - series[0]!;
  const tone = net > 0 ? "up" : net < 0 ? "down" : "flat";
  return (
    <svg className={`spark spark--${tone}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`trust history, ${series.length - 1} updates`}>
      <line className="spark__base" x1={2} y1={y(5000)} x2={W - 3} y2={y(5000)} />
      <polyline points={points} pathLength={1} />
      <circle cx={x(series.length - 1)} cy={y(series[series.length - 1]!)} r={2.6} />
    </svg>
  );
}
