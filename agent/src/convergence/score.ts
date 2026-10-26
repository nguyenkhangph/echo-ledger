import type { GroupedSignal } from "./group";
import {
  CONVERGENCE_THRESHOLD,
  ConvergenceCandidate,
  type CandidateSource,
  type ConvergenceCandidate as ConvergenceCandidateType,
} from "./schema";

type Sentiment = CandidateSource["sentiment"];
const SENTIMENT_TIE_ORDER: readonly Sentiment[] = ["bullish", "bearish", "neutral"];

/** Count wins; equal counts are resolved by conviction sum, then fixed sentiment order. */
export function dominantSentiment(sources: readonly CandidateSource[]): Sentiment | null {
  if (sources.length === 0) return null;
  const stats = new Map<Sentiment, { count: number; conviction: number }>(
    SENTIMENT_TIE_ORDER.map((sentiment) => [sentiment, { count: 0, conviction: 0 }]),
  );
  for (const source of sources) {
    const current = stats.get(source.sentiment)!;
    current.count += 1;
    current.conviction += source.conviction;
  }
  return [...SENTIMENT_TIE_ORDER].sort((left, right) => {
    const leftStats = stats.get(left)!;
    const rightStats = stats.get(right)!;
    return rightStats.count - leftStats.count || rightStats.conviction - leftStats.conviction;
  })[0]!;
}

export function scoreConvergence(
  token: string,
  sources: readonly GroupedSignal[],
  windowHours: number,
): ConvergenceCandidateType {
  const displayedSources: CandidateSource[] = sources.map(({ posted_at: _postedAt, ...source }) => source);
  const independent = displayedSources.filter((source) => !source.is_echo);
  const echoCount = displayedSources.length - independent.length;
  const dominant = dominantSentiment(independent);
  const agreeingIndependentCount = dominant === null
    ? 0
    : independent.filter((source) => source.sentiment === dominant).length;
  const score = independent.length === 0 ? 0 : agreeingIndependentCount / Math.max(independent.length, 1);

  return ConvergenceCandidate.parse({
    token,
    window_h: windowHours,
    sources: displayedSources,
    convergence: {
      independent_count: independent.length,
      echo_count: echoCount,
      agreeing_independent_count: agreeingIndependentCount,
      score,
      threshold: CONVERGENCE_THRESHOLD,
      passed: score >= CONVERGENCE_THRESHOLD && independent.length >= 2,
    },
    evidence: null,
  });
}