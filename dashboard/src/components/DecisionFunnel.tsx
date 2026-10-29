import { useLedger } from "../data/ledger";
import { candidates, pipelineStats, WINDOW_HOURS } from "../data/pipeline";

type Stage = { label: string; value: number | null; note?: string; scope?: string; chips?: string[] };

/** Bar length for a count; log-scaled so 79 posts and 1 passing token are both readable. */
const widthFor = (value: number | null, max: number) => (value == null || max <= 0 ? 6 : Math.max(6, (Math.log1p(value) / Math.log1p(max)) * 100));

export function DecisionFunnel() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;

  const { postsInWindow, sponsoredInWindow, signalsInWindow, echoesInWindow, echoesTotal, sources } = pipelineStats;
  const independentCalls = Math.max(0, signalsInWindow - echoesInWindow);
  const passed = candidates.filter((candidate) => candidate.convergence.passed).length;
  const noCall = Math.max(0, postsInWindow - sponsoredInWindow - signalsInWindow);

  const positions = snapshot?.positions ?? [];
  const rejected = positions.filter((position) => position.attestation === "REJECT" || position.side === "NONE").length;
  const settled = positions.filter((position) => position.settled && position.side !== "NONE").length;
  const opened = positions.length - rejected;

  const stages: Stage[] = [
    { label: "Posts read", value: postsInWindow, scope: `${WINDOW_HOURS}h`, note: sponsoredInWindow ? `${sponsoredInWindow} sponsored set aside` : undefined },
    { label: "Actionable calls", value: signalsInWindow, scope: `${WINDOW_HOURS}h`, note: `${noCall} had no clear call` },
    {
      label: "Independent calls",
      value: independentCalls,
      scope: `${WINDOW_HOURS}h`,
      note: `${echoesInWindow} echo discounted · ${echoesTotal} caught in all`,
    },
    {
      label: "Tokens past the 0.60 bar",
      value: passed,
      scope: "latest cycle",
      note: candidates.length ? `${candidates.length - passed} of ${candidates.length} tokens stayed below` : undefined,
    },
    {
      label: "Decisions on-chain",
      value: snapshot ? positions.length : null,
      scope: "all time",
      chips: snapshot ? [`${opened} opened`, `${rejected} rejected`, `${settled} settled`] : undefined,
    },
  ];
  const windowMax = Math.max(1, postsInWindow);

  return (
    <div className="funnel" aria-label="Decision funnel">
      <div className="funnel__head mono-font">
        <span><i className="live-dot" aria-hidden="true" />Decision funnel</span>
        <span>{sources} sources watched</span>
      </div>
      <ol className="funnel__rows">
        {stages.map((stage, index) => {
          const chain = index === stages.length - 1;
          const max = chain ? Math.max(1, stage.value ?? 1) : windowMax;
          return (
            <li key={stage.label} className={`funnel__row${chain ? " funnel__row--chain" : ""}`}>
              <div className="funnel__line">
                <span className="funnel__label">
                  {stage.label}
                  <em className="mono-font">{stage.scope}</em>
                </span>
                <b className="mono-font">{stage.value == null ? "…" : stage.value}</b>
              </div>
              <div className="funnel__track">
                <i className="funnel__bar" style={{ width: `${chain ? (stage.value == null ? 6 : 100) : widthFor(stage.value, max)}%`, animationDelay: `${300 + index * 130}ms` }} />
              </div>
              {stage.note && <p className="funnel__note mono-font">{stage.note}</p>}
              {stage.chips && (
                <p className="funnel__chips mono-font">
                  {stage.chips.map((chip) => <span key={chip}>{chip}</span>)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
