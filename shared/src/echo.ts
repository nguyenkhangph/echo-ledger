/**
 * Scoring views of one narrative. `independentScore` is the rule the agent gates on (mirrors
 * agent/src/convergence/score.ts, and a parity test keeps them identical). The other two are comparisons:
 * what a bot that counts every repeated post as a voice would have scored, and a shadow score that weights
 * each independent voice by the trust the ledger has recorded for it.
 */

export const CONVERGENCE_THRESHOLD = 0.6;

export type VoteSource = { handle: string; sentiment: "bullish" | "bearish" | "neutral"; conviction: number; is_echo: boolean };

const TIE_ORDER = ["bullish", "bearish", "neutral"] as const;

/** Count wins; equal counts are resolved by conviction sum, then the fixed order. Same tie-break as the agent. */
export function dominant(sources: readonly VoteSource[]): VoteSource["sentiment"] | null {
  if (sources.length === 0) return null;
  const stats = new Map<string, { count: number; conviction: number }>(TIE_ORDER.map((s) => [s, { count: 0, conviction: 0 }]));
  for (const source of sources) {
    const entry = stats.get(source.sentiment)!;
    entry.count += 1;
    entry.conviction += source.conviction;
  }
  return [...TIE_ORDER].sort((a, b) => stats.get(b)!.count - stats.get(a)!.count || stats.get(b)!.conviction - stats.get(a)!.conviction)[0]!;
}

export type VoteScore = { score: number; voices: number; agreeing: number; side: VoteSource["sentiment"] | null; passes: boolean };

function scoreOf(voices: readonly VoteSource[]): VoteScore {
  const side = dominant(voices);
  const agreeing = side === null ? 0 : voices.filter((v) => v.sentiment === side).length;
  const score = voices.length === 0 ? 0 : agreeing / voices.length;
  return { score, voices: voices.length, agreeing, side, passes: score >= CONVERGENCE_THRESHOLD && voices.length >= 2 };
}

/** The agent's rule: echoes are discarded before counting. */
export const independentScore = (sources: readonly VoteSource[]): VoteScore => scoreOf(sources.filter((s) => !s.is_echo));

/** The naive rule: every repeated post counts as one more voice. */
export const naiveScore = (sources: readonly VoteSource[]): VoteScore => scoreOf(sources);

/** True when counting echoes would have opened a decision the echo filter stopped. */
export const echoFlippedVerdict = (sources: readonly VoteSource[]): boolean => naiveScore(sources).passes && !independentScore(sources).passes;

/**
 * Shadow score: the agreeing share of the independent voices, each weighted by its recorded trust (0..1).
 * Voices with no record weigh the neutral 0.5. It does not gate anything; it shows what memory would change.
 */
export function trustWeightedScore(sources: readonly VoteSource[], trustOf: (handle: string) => number | null): number {
  const independent = sources.filter((s) => !s.is_echo);
  const side = dominant(independent);
  if (side === null) return 0;
  const weight = (s: VoteSource) => trustOf(s.handle) ?? 0.5;
  const total = independent.reduce((sum, s) => sum + weight(s), 0);
  if (total === 0) return 0;
  return independent.filter((s) => s.sentiment === side).reduce((sum, s) => sum + weight(s), 0) / total;
}

/**
 * Leave-one-out test: the voices whose removal alone would flip the verdict (pass ↔ no pass). An empty list means
 * no single voice decides the outcome, which is the robustness a reader should want.
 */
export function pivotalVoices(sources: readonly VoteSource[]): string[] {
  const base = independentScore(sources).passes;
  return sources.filter((_, i) => independentScore(sources.filter((__, j) => j !== i)).passes !== base).map((s) => s.handle);
}
