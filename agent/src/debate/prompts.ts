import type { ConvergenceCandidate } from "../convergence/schema";
import type { ExtractedSignal } from "../extract/schema";
import type { DebateArgument } from "./schema";
import type { AdvisoryRiskConfig } from "./config";

export interface DebateSourceContext {
  post_id: string;
  handle: string;
  sentiment: ConvergenceCandidate["sources"][number]["sentiment"];
  conviction: number;
  timeframe: ExtractedSignal["timeframe"];
  is_echo: boolean;
  echo_of: string | null;
  reasoning_summary: string;
}

export interface DebatePromptContext {
  candidate: ConvergenceCandidate;
  sources: DebateSourceContext[];
}

const OFFCHAIN_WARNING = "This is an off-chain PRACTICE/paper-trading debate. It is not a real order or the authoritative CRE risk gate.";

export const BULL_SYSTEM_PROMPT = `${OFFCHAIN_WARNING}
Argue FOR opening a practice position. Return only JSON: {"argument":"..."}. Cite specific independent source handles and their conviction values. Use only is_echo=false sources as affirmative support. Discuss available price change and market cap evidence; explicitly state when evidence is unavailable. Do not invent volume, prices, sources, or facts.`;

export const BEAR_SYSTEM_PROMPT = `${OFFCHAIN_WARNING}
Argue AGAINST opening a practice position. Return only JSON: {"argument":"..."}. Cite specific source handles and data. Look for an independent count near the two-source minimum, sentiment or timeframe conflict, a large prior 24h move that suggests chasing, absent or weak market evidence, low market cap, and echo-chain contamination. Do not invent facts.`;

export const JUDGE_SYSTEM_PROMPT = `${OFFCHAIN_WARNING}
Act as an impartial judge. Return only JSON with action, suggested_size_pct, verdict, confidence, and advisory_risk_rules. action must be open_long, open_short, or no_action. no_action requires size 0; an open action requires a positive size. Explain which argument was more convincing and why.

advisory_risk_rules statuses are PASS, FAIL, or UNKNOWN. lead_min_ok is UNKNOWN when lead timing is unavailable. price_deviation_ok is UNKNOWN because there is no multi-source price comparison at this stage. min_mcap_ok compares observed market cap with the configured minimum, or UNKNOWN when absent. max_position_pct_ok compares suggested_size_pct with the configured maximum. max_open_ok must be exactly "unknown_requires_onchain_read".

These checks are advisory only. CRE must independently re-fetch finalized data, read on-chain open positions, and enforce its deterministic gate; never describe this output as authorization.`;

function data(context: DebatePromptContext): string {
  return JSON.stringify({
    candidate: context.candidate,
    source_context: context.sources,
  });
}

export function bullUserPrompt(context: DebatePromptContext): string {
  const independent = context.sources.filter((source) => !source.is_echo);
  return `Build the bull case from this data. Independent sources allowed as support:\n${JSON.stringify({
    token: context.candidate.token,
    convergence: context.candidate.convergence,
    independent_sources: independent,
    evidence: context.candidate.evidence,
  })}`;
}

export function bearUserPrompt(context: DebatePromptContext): string {
  return `Build the bear case from all raw candidate data, including echoes and timeframe metadata:\n${data(context)}`;
}

export function judgeUserPrompt(
  context: DebatePromptContext,
  bull: DebateArgument,
  bear: DebateArgument,
  riskConfig: AdvisoryRiskConfig,
): string {
  return `Judge this practice-position debate:\n${JSON.stringify({
    raw_candidate: context.candidate,
    source_context: context.sources,
    bull_argument: bull.argument,
    bear_argument: bear.argument,
    advisory_config: riskConfig,
    availability: {
      lead_min: "unavailable",
      multi_source_price_deviation: "unavailable",
      current_open_positions: "requires_onchain_read",
    },
  })}`;
}