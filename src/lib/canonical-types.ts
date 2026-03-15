/* ═══════════════════════════════════════════════════════════ */
/*   CANONICAL TYPES — Single Source of Truth for TAO Sentinel */
/*   Every field has:                                          */
/*   - a unique canonical name                                 */
/*   - a source provenance                                     */
/*   - a timestamp                                             */
/*   - an optional verifiable reference                        */
/*   NO scoring, NO logic — just type definitions.             */
/* ═══════════════════════════════════════════════════════════ */

/* ── Source Provenance ── */

export type SourceType =
  | "taostats"         // TaoStats API (primary on-chain)
  | "taostats:chain"   // TaoStats chain/metagraph data
  | "taoflute"         // TaoFlute screening (secondary)
  | "social"           // Social signal module
  | "computed"         // Locally computed from raw inputs
  | "unavailable";     // Not available from any source

export type SourceProvenance = {
  source_name: string;       // e.g. "TaoStats", "TaoFlute", "X/Twitter"
  source_type: SourceType;
  source_url_or_ref: string | null;  // verifiable link if available
  source_timestamp: string | null;    // ISO timestamp of the source data
  source_confidence: number;          // 0-100 confidence in this source
};

/* ── TaoFlute External Status ── */

export type ExternalStatus =
  | "NONE"
  | "WATCH"
  | "P1" | "P2" | "P3" | "P4" | "P5"
  | "P6" | "P7" | "P8" | "P9" | "P10";

/* ── Canonical Subnet Facts ── */

/**
 * Complete canonical fact sheet for a single subnet.
 * Merges TaoStats (primary), TaoFlute (secondary), and Social (tertiary).
 * Every page reads from this — no local re-derivation of raw facts.
 */
export type CanonicalSubnetFacts = {
  subnet_id: number;
  subnet_name: string | null;
  category: string | null;

  /* ── Price & Market ── */
  price: number | null;            // α price in TAO
  price_usd: number | null;       // computed: price × taoUsd
  change_1h: number | null;       // %
  change_24h: number | null;      // %
  change_7d: number | null;       // %
  change_30d: number | null;      // %
  market_cap: number | null;      // in TAO
  market_cap_usd: number | null;  // computed
  fdv: number | null;             // computed
  volume_24h: number | null;      // in TAO
  volume_24h_usd: number | null;  // computed

  /* ── Trading Activity ── */
  buys_count: number | null;
  sells_count: number | null;
  buyers_count: number | null;
  sellers_count: number | null;
  sentiment_score_raw: number | null;  // buy/(buy+sell) ratio

  /* ── Pool / AMM ── */
  tao_in_pool: number | null;
  alpha_in_pool: number | null;
  tao_pool_ratio: number | null;     // computed: taoInPool / alphaInPool
  spread: number | null;              // computed from AMM
  slippage_1tau: number | null;       // computed
  slippage_10tau: number | null;      // computed
  depth: number | null;               // = taoInPool (depth proxy)

  /* ── Emissions & Economics ── */
  emissions_pct: number | null;       // emission share of total
  emissions_day: number | null;       // TAO per day
  root_proportion: number | null;     // 0-1
  owner_day: number | null;           // owner TAO/day
  miner_day: number | null;           // miner TAO/day
  validator_day: number | null;       // validator TAO/day
  incentive_burn_pct: number | null;  // burn percentage
  circulating_supply: number | null;
  total_supply: number | null;

  /* ── Structure ── */
  uid_saturation: number | null;    // 0-1
  validators: number | null;
  miners: number | null;
  holders: number | null;

  /* ── TaoFlute External Risk ── */
  taoflute_match: boolean;
  external_status: ExternalStatus;
  liq_price: number | null;         // TaoFlute liq price
  liq_haircut: number | null;       // TaoFlute liq haircut %
  taoflute_flags: string[];
  taoflute_links: string[];

  /* ── Social Signal ── */
  social_mentions_24h: number | null;
  social_mentions_delta: number | null;    // change vs previous period
  social_unique_accounts: number | null;
  social_kol_mentions: number | null;
  social_official_mentions: number | null;
  social_sentiment_score: number | null;   // -100 to +100
  social_hype_score: number | null;        // 0-100
  social_credibility_score: number | null; // 0-100
  social_signal_strength: number | null;   // 0-100

  /* ── Timestamps & Source References ── */
  taostats_timestamp: string | null;
  taoflute_timestamp: string | null;
  social_timestamp: string | null;
  sentinel_timestamp: string;             // when Sentinel assembled this

  /* ── Verifiable Source References ── */
  taostats_source_url: string | null;
  taoflute_source_ref: string | null;
  social_source_refs: string[];

  /* ── Source Provenance Map (for audit) ── */
  provenance: Record<string, SourceProvenance>;
};

/* ── Final Action ── */

export type CanonicalFinalAction =
  | "ENTRER"
  | "SURVEILLER"
  | "SORTIR"
  | "ÉVITER"
  | "SYSTÈME"
  | "AUCUNE_DECISION";

/* ── Raw Signal ── */

export type CanonicalRawSignal =
  | "OPPORTUNITE"
  | "NEUTRE"
  | "RISQUE";

/* ── Portfolio Action ── */

export type CanonicalPortfolioAction =
  | "ADD"
  | "HOLD"
  | "REDUCE"
  | "EXIT"
  | "BLOCK";

/* ── Canonical Subnet Decision ── */

/**
 * The single authoritative decision for a subnet.
 * Produced ONCE by the canonical decision builder.
 * Consumed EVERYWHERE — no local re-derivation.
 */
export type CanonicalSubnetDecision = {
  subnet_id: number;

  /* ── Final Action ── */
  final_action: CanonicalFinalAction;
  final_reason_primary: string;
  final_reason_secondary: string[];

  /* ── Raw Signal (before guardrails) ── */
  raw_signal: CanonicalRawSignal;
  raw_signal_reason: string[];

  /* ── Guardrails ── */
  guardrail_active: boolean;
  guardrail_reason: string[];

  /* ── Core Scores ── */
  confidence_score: number;           // 0-100
  conviction_score: number;           // 0-100
  momentum_score: number;             // 0-100

  /* ── Risk Scores ── */
  risk_market_score: number;          // 0-100 (market-driven risk)
  risk_decision_score: number;        // 0-100 (final decision risk)

  /* ── Structural Scores ── */
  structural_fragility_score: number; // 0-100
  concentration_risk_score: number;   // 0-100

  /* ── Liquidity / Execution Scores ── */
  liquidity_quality_score: number;    // 0-100
  execution_quality_score: number;    // 0-100

  /* ── External Risk Scores ── */
  depeg_risk_score: number;           // 0-100
  delist_risk_score: number;          // 0-100

  /* ── Social Scores ── */
  social_signal_score: number;        // 0-100
  social_confidence_score: number;    // 0-100

  /* ── Data Quality Scores ── */
  source_concordance_score: number;   // 0-100
  data_confidence_score: number;      // 0-100

  /* ── Portfolio Mapping ── */
  portfolio_action: CanonicalPortfolioAction;

  /* ── Metadata ── */
  updated_at: string;
};
