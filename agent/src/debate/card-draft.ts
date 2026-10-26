import { createHash } from "node:crypto";

import { ReasoningCard, type ReasoningCard as ReasoningCardType } from "../../../shared/src/card";

import type { ConvergenceCandidate } from "../convergence/schema";
import { EXTRACTION_SYSTEM_PROMPT } from "../extract/prompt";
import type { ExtractedSignal } from "../extract/schema";
import type { IngestedPost } from "../ingest/types";
import { ADVISORY_RISK_CONFIG, type AdvisoryRiskConfig } from "./config";
import { BEAR_SYSTEM_PROMPT, BULL_SYSTEM_PROMPT, JUDGE_SYSTEM_PROMPT } from "./prompts";
import type { DebateResult } from "./schema";

export interface DraftSourceContext {
  post: IngestedPost;
  signal: ExtractedSignal;
}

export interface AssembleDraftOptions {
  candidate: ConvergenceCandidate;
  debate: DebateResult;
  sourceContexts: ReadonlyMap<string, DraftSourceContext>;
  debateModel: string;
  extractModel?: string;
  createdAt?: Date;
  riskConfig?: AdvisoryRiskConfig;
}

function promptHash(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

function urgency(timeframe: ExtractedSignal["timeframe"]): number {
  if (timeframe === "short") return 1;
  if (timeframe === "medium") return 0.6;
  if (timeframe === "long") return 0.3;
  return 0.5;
}

function sentiment(value: ExtractedSignal["sentiment"]): "bull" | "bear" | "neutral" {
  if (value === "bullish") return "bull";
  if (value === "bearish") return "bear";
  return "neutral";
}

function draftId(candidate: ConvergenceCandidate): string {
  const sourceIds = candidate.sources.map((source) => source.post_id).sort().join("|");
  return `draft-${candidate.token.toLowerCase()}-${createHash("sha256").update(sourceIds).digest("hex").slice(0, 12)}`;
}

/**
 * Builds an off-chain draft only. The advisory risk settings and all LLM output are untrusted by CRE.
 * CRE must independently verify finalized evidence and on-chain limits before recording any PRACTICE position.
 */
export function assembleDraftCard({
  candidate,
  debate,
  sourceContexts,
  debateModel,
  extractModel = "unknown",
  createdAt = new Date(),
  riskConfig = ADVISORY_RISK_CONFIG,
}: AssembleDraftOptions): ReasoningCardType {
  const sources = candidate.sources.map((source) => {
    const context = sourceContexts.get(source.post_id);
    if (!context) throw new Error(`Missing source context for ${source.post_id}`);
    return {
      kol: context.post.handle,
      platform: context.post.platform,
      url: context.post.url,
      posted_at: context.post.posted_at,
      quote: context.post.text,
      extract: {
        sentiment: sentiment(context.signal.sentiment),
        conviction: context.signal.conviction,
        urgency: urgency(context.signal.timeframe),
      },
      indep: context.signal.is_echo ? 0.3 as const : 1.0 as const,
      ...(context.post.echo_of ? { echo_of: context.post.echo_of } : {}),
    };
  });
  const action = debate.judge.action;

  return ReasoningCard.parse({
    card_id: draftId(candidate),
    created_at: createdAt.toISOString(),
    token: candidate.token,
    window_h: candidate.window_h,
    sources,
    convergence: {
      score: candidate.convergence.score,
      independent_kols: candidate.convergence.independent_count,
      echo_dropped: candidate.convergence.echo_count,
      threshold: candidate.convergence.threshold,
    },
    evidence: {
      // A3 has a snapshot, not lead-time, volume, or multi-source deviation evidence. A5/CRE must replace these placeholders.
      lead_min: 0,
      px_change_before_pct: candidate.evidence?.change_24h_pct ?? 0,
      vol_ratio: 0,
      price_sources: candidate.evidence ? [candidate.evidence.source] : [],
    },
    debate: {
      bull: debate.bull.argument,
      bear: debate.bear.argument,
      verdict: action === "no_action" ? "REJECT" : "APPROVE",
      confidence: debate.judge.confidence,
      models: [debateModel],
    },
    risk_rules: riskConfig,
    models: {
      extract_model: extractModel,
      judge_model: debateModel,
      prompt_hashes: {
        extract: promptHash(EXTRACTION_SYSTEM_PROMPT),
        bull: promptHash(BULL_SYSTEM_PROMPT),
        bear: promptHash(BEAR_SYSTEM_PROMPT),
        judge: promptHash(JUDGE_SYSTEM_PROMPT),
      },
    },
    decision: {
      side: action === "open_long" ? "long" : action === "open_short" ? "short" : "none",
      size_pct: debate.judge.suggested_size_pct,
    },
  });
}