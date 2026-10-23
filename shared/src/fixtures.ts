import type { ReasoningCard } from "./card";

const models = {
  extract_model: "openai/gpt-5-mini",
  judge_model: "anthropic/claude-sonnet-4-5",
  prompt_hashes: {
    extract: "sha256:extract-v1",
    debate: "sha256:debate-v1",
    judge: "sha256:judge-v1",
  },
} as const;

const riskRules = {
  max_position_pct: 0.05,
  max_open: 3,
  stop_loss_pct: 0.08,
  min_mcap_usd: 10_000_000,
  horizon_h: 24,
} as const;

export const approveLongCard = {
  card_id: "card-sol-approve-001",
  created_at: "2026-10-20T12:30:00.000Z",
  token: "SOL",
  window_h: 6,
  sources: [
    {
      kol: "alice-crypto",
      platform: "x",
      url: "https://x.com/alice/status/1001",
      posted_at: "2026-10-20T11:10:00.000Z",
      quote: "SOL validator demand is accelerating independently of price.",
      extract: { sentiment: "bull", conviction: 0.88, urgency: 0.7 },
      indep: 1.0,
    },
    {
      kol: "block-research",
      platform: "telegram",
      url: "https://t.me/blockresearch/2002",
      posted_at: "2026-10-20T11:42:00.000Z",
      quote: "On-chain activity supports a bullish SOL setup.",
      extract: { sentiment: "bull", conviction: 0.81, urgency: 0.61 },
      indep: 1.0,
    },
  ],
  convergence: {
    score: 0.84,
    independent_kols: 2,
    echo_dropped: 0,
    threshold: 0.7,
  },
  evidence: {
    lead_min: 38,
    px_change_before_pct: 0.6,
    vol_ratio: 1.42,
    price_sources: ["chainlink", "coinbase"],
  },
  debate: {
    bull: "Independent sources led price and volume confirms interest.",
    bear: "The observation window is short and volatility remains elevated.",
    verdict: "APPROVE",
    confidence: 0.82,
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4-5"],
  },
  risk_rules: riskRules,
  models,
  decision: { side: "long", size_pct: 0.04 },
} satisfies ReasoningCard;

export const rejectNarrativeChasingCard = {
  card_id: "card-eth-chasing-001",
  created_at: "2026-10-20T15:00:00.000Z",
  token: "ETH",
  window_h: 4,
  sources: [
    {
      kol: "momentum-desk",
      platform: "discord",
      url: "https://discord.com/channels/123/456/789",
      posted_at: "2026-10-20T14:45:00.000Z",
      quote: "ETH breakout looks unstoppable after today's move.",
      extract: { sentiment: "bull", conviction: 0.91, urgency: 0.94 },
      indep: 0.5,
      echo_of: "https://x.com/marketwire/status/3003",
    },
  ],
  convergence: {
    score: 0.72,
    independent_kols: 1,
    echo_dropped: 2,
    threshold: 0.7,
  },
  evidence: {
    lead_min: -27,
    px_change_before_pct: 8.4,
    vol_ratio: 2.7,
    price_sources: ["chainlink", "kraken"],
  },
  debate: {
    bull: "Price and volume momentum are strong.",
    bear: "The narrative arrived 27 minutes after the move and is chasing price.",
    verdict: "REJECT",
    confidence: 0.93,
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4-5"],
  },
  risk_rules: riskRules,
  models,
  decision: { side: "none", size_pct: 0 },
} satisfies ReasoningCard;

export const rejectRiskRuleCard = {
  card_id: "card-micro-risk-001",
  created_at: "2026-10-21T09:00:00.000Z",
  token: "MICRO",
  window_h: 8,
  sources: [
    {
      kol: "small-cap-scout",
      platform: "x",
      url: "https://x.com/smallcap/status/4004",
      posted_at: "2026-10-21T08:05:00.000Z",
      quote: "MICRO has a promising protocol launch this week.",
      extract: { sentiment: "bull", conviction: 0.74, urgency: 0.52 },
      indep: 1.0,
    },
  ],
  convergence: {
    score: 0.71,
    independent_kols: 1,
    echo_dropped: 0,
    threshold: 0.7,
  },
  evidence: {
    lead_min: 55,
    px_change_before_pct: 0.2,
    vol_ratio: 1.18,
    price_sources: ["dex-twap"],
  },
  debate: {
    bull: "The source led price and the launch is a credible catalyst.",
    bear: "Observed market cap is below the configured $10m minimum.",
    verdict: "REJECT",
    confidence: 0.97,
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-4-5"],
  },
  risk_rules: riskRules,
  models,
  decision: { side: "none", size_pct: 0 },
} satisfies ReasoningCard;

export const exampleCards: readonly ReasoningCard[] = [
  approveLongCard,
  rejectNarrativeChasingCard,
  rejectRiskRuleCard,
];