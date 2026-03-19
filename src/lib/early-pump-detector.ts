/* ═══════════════════════════════════════════════════════════ */
/*   EARLY PUMP DETECTOR — Identify subnets emerging from     */
/*   obscurity before the crowd, using verifiable public data */
/*   NO mock data — purely derived from canonical facts +     */
/*   social scores + market metrics.                          */
/* ═══════════════════════════════════════════════════════════ */

import type { CanonicalSubnetFacts } from "./canonical-types";
import type { CanonicalSubnetDecision } from "./canonical-types";
import { clamp } from "./gauge-types";

/* ── Types ── */

export type EarlyPumpTag =
  | "EARLY_PUMP_CANDIDATE"   // high score, no critical block
  | "EARLY_PUMP_WATCH"       // high score but external risk active
  | "LATE_MOMENTUM"          // pump already advanced
  | null;                    // no signal

export type EarlyPumpResult = {
  tag: EarlyPumpTag;
  early_pump_score: number;          // 0-100 composite
  social_acceleration_score: number; // 0-100
  market_awakening_score: number;    // 0-100
  execution_viability_score: number; // 0-100
  invalidation_score: number;        // 0-100 (penalty)
  reasons: string[];
  detected_at: string;
  source_refs: string[];
};

/* ── Weights ── */
const W_SOCIAL = 0.25;
const W_MARKET = 0.35;
const W_EXECUTION = 0.20;
const W_INVALIDATION = 0.20;

/* ── Thresholds ── */
const EARLY_PUMP_THRESHOLD = 55;
const LATE_MOMENTUM_CHANGE_7D = 40;   // if 7d change > 40%, pump is already advanced
const LATE_MOMENTUM_CHANGE_24H = 25;  // if 24h change > 25%, pump is already advanced

/* ═══════════════════════════════════ */
/*   1. SOCIAL ACCELERATION SCORE     */
/* ═══════════════════════════════════ */

function computeSocialAcceleration(
  f: CanonicalSubnetFacts,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const mentions = f.social_mentions_24h ?? 0;
  const uniqueAccounts = f.social_unique_accounts ?? 0;
  const kolScore = f.social_kol_mentions ?? 0;  // 0-100, weighted by tier A/B
  const hypeScore = f.social_hype_score ?? 0;
  const signalStrength = f.social_signal_strength ?? 0;

  // Mentions present → base signal
  if (mentions >= 2) {
    score += 15;
    reasons.push(`${mentions} mentions sociales détectées`);
  }
  if (mentions >= 5) {
    score += 10;
  }

  // Unique account diversity (anti-single-source)
  if (uniqueAccounts >= 3) {
    score += 20;
    reasons.push(`${uniqueAccounts} comptes uniques — signal diversifié`);
  } else if (uniqueAccounts >= 2) {
    score += 10;
    reasons.push(`${uniqueAccounts} comptes uniques`);
  } else if (uniqueAccounts === 1 && mentions > 0) {
    // Penalty: single source concentration
    score -= 10;
    reasons.push("Source unique — concentration sociale");
  }

  // KOL tier A/B weighting (smart_kol_score > 50 = tier A/B present)
  if (kolScore > 70) {
    score += 25;
    reasons.push(`KOL Tier A/B actif (score: ${kolScore})`);
  } else if (kolScore > 40) {
    score += 15;
    reasons.push(`Signal KOL modéré (score: ${kolScore})`);
  }

  // Heat / hype momentum
  if (hypeScore > 60) {
    score += 15;
    reasons.push(`Heat sociale élevée (${hypeScore})`);
  } else if (hypeScore > 30) {
    score += 8;
  }

  // Signal strength from conviction engine
  if (signalStrength > 40) {
    score += 15;
    reasons.push(`Conviction sociale ${signalStrength}/100`);
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   2. MARKET AWAKENING SCORE        */
/* ═══════════════════════════════════ */

function computeMarketAwakening(
  f: CanonicalSubnetFacts,
  d: CanonicalSubnetDecision,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const ch1h = f.change_1h ?? 0;
  const ch24h = f.change_24h ?? 0;
  const ch7d = f.change_7d ?? 0;
  const vol24h = f.volume_24h ?? 0;
  const buys = f.buys_count ?? 0;
  const buyers = f.buyers_count ?? 0;
  const sentiment = f.sentiment_score_raw ?? 50;
  const momentum = d.momentum_score;

  // Progressive price action (positive but not extreme = early)
  if (ch24h > 3 && ch24h <= 25) {
    score += 20;
    reasons.push(`Hausse 24h progressive: +${ch24h.toFixed(1)}%`);
  } else if (ch24h > 25) {
    // Already extended — reduces "early" qualification
    score += 5;
  }

  if (ch1h > 1 && ch1h <= 10) {
    score += 10;
    reasons.push(`Mouvement 1h: +${ch1h.toFixed(1)}%`);
  }

  // 7d trend should be emerging, not already exploded
  if (ch7d > 5 && ch7d <= 40) {
    score += 15;
    reasons.push(`Tendance 7j émergente: +${ch7d.toFixed(1)}%`);
  }

  // Volume acceleration
  if (vol24h > 0.5) {
    score += 10;
    reasons.push(`Volume 24h: ${vol24h.toFixed(2)} τ`);
  }
  if (vol24h > 2) {
    score += 5;
  }

  // Buy pressure
  if (buys > 3 && sentiment > 55) {
    score += 15;
    reasons.push(`Pression acheteuse: ${buys} achats, sentiment ${sentiment}%`);
  }

  // Unique buyers growing
  if (buyers >= 3) {
    score += 10;
    reasons.push(`${buyers} acheteurs uniques`);
  }

  // Momentum from decision engine
  if (momentum > 55 && momentum <= 80) {
    score += 15;
    reasons.push(`Momentum croissant (${momentum}/100)`);
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   3. EXECUTION VIABILITY SCORE     */
/* ═══════════════════════════════════ */

function computeExecutionViability(
  f: CanonicalSubnetFacts,
  d: CanonicalSubnetDecision,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50; // baseline: assume viable until proven otherwise

  const liqScore = d.liquidity_quality_score;
  const execScore = d.execution_quality_score;
  const slippage = f.slippage_10tau ?? 100;
  const spread = f.spread ?? 100;
  const depth = f.depth ?? 0;

  // Liquidity quality from canonical decision
  if (liqScore > 60) {
    score += 20;
    reasons.push(`Liquidité correcte (${liqScore}/100)`);
  } else if (liqScore > 40) {
    score += 10;
  } else {
    score -= 15;
    reasons.push(`Liquidité faible (${liqScore}/100)`);
  }

  // Execution quality
  if (execScore > 60) {
    score += 15;
  } else if (execScore < 35) {
    score -= 15;
    reasons.push(`Exécution dégradée (${execScore}/100)`);
  }

  // Slippage check
  if (slippage < 5) {
    score += 10;
    reasons.push(`Slippage acceptable (${slippage.toFixed(1)}%)`);
  } else if (slippage > 15) {
    score -= 15;
    reasons.push(`Slippage excessif (${slippage.toFixed(1)}%)`);
  }

  // Spread check
  if (spread < 0.5) {
    score += 5;
  } else if (spread > 2) {
    score -= 10;
    reasons.push(`Spread élevé (${spread.toFixed(2)}%)`);
  }

  // Depth minimum
  if (depth > 50) {
    score += 5;
  } else if (depth < 5) {
    score -= 15;
    reasons.push(`Profondeur insuffisante (${depth.toFixed(1)} τ)`);
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   4. INVALIDATION SCORE (MALUS)    */
/* ═══════════════════════════════════ */

function computeInvalidation(
  f: CanonicalSubnetFacts,
  d: CanonicalSubnetDecision,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // TaoFlute WATCH / Priority malus
  const extStatus = f.external_status;
  if (extStatus.startsWith("P")) {
    score += 40;
    reasons.push(`TaoFlute Priority (${extStatus}) — risque delist majeur`);
  } else if (extStatus === "WATCH") {
    score += 20;
    reasons.push("TaoFlute WATCH — surveillance externe active");
  }

  // Delist risk from decision engine
  if (d.delist_risk_score > 60) {
    score += 20;
    reasons.push(`Risque delist élevé (${d.delist_risk_score}/100)`);
  } else if (d.delist_risk_score > 30) {
    score += 10;
  }

  // Depeg risk
  if (d.depeg_risk_score > 50) {
    score += 20;
    reasons.push(`Risque depeg (${d.depeg_risk_score}/100)`);
  } else if (d.depeg_risk_score > 25) {
    score += 10;
  }

  // Concentration risk (extreme)
  if (d.concentration_risk_score > 70) {
    score += 15;
    reasons.push(`Concentration extrême (${d.concentration_risk_score}/100)`);
  }

  // Structural fragility (toxic structure)
  if (d.structural_fragility_score > 70) {
    score += 15;
    reasons.push(`Structure fragile (${d.structural_fragility_score}/100)`);
  }

  // Pump already too advanced (not "early" anymore)
  const ch7d = f.change_7d ?? 0;
  const ch24h = f.change_24h ?? 0;
  if (ch7d > LATE_MOMENTUM_CHANGE_7D || ch24h > LATE_MOMENTUM_CHANGE_24H) {
    score += 25;
    reasons.push(`Pump déjà avancé (7j: +${ch7d.toFixed(1)}%, 24h: +${ch24h.toFixed(1)}%)`);
  }

  // Guardrail active = blocked by engine
  if (d.guardrail_active && (d.final_action === "SORTIR" || d.final_action === "ÉVITER")) {
    score += 30;
    reasons.push("Garde-fou actif — verdict bloquant");
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   COMPOSITE SCORE & TAG            */
/* ═══════════════════════════════════ */

export function detectEarlyPump(
  facts: CanonicalSubnetFacts,
  decision: CanonicalSubnetDecision,
): EarlyPumpResult {
  const now = new Date().toISOString();

  // Skip system subnets
  if (facts.subnet_id === 0) {
    return { tag: null, early_pump_score: 0, social_acceleration_score: 0, market_awakening_score: 0, execution_viability_score: 0, invalidation_score: 0, reasons: [], detected_at: now, source_refs: [] };
  }

  const social = computeSocialAcceleration(facts);
  const market = computeMarketAwakening(facts, decision);
  const execution = computeExecutionViability(facts, decision);
  const invalidation = computeInvalidation(facts, decision);

  // Composite: weighted sum minus invalidation penalty
  const rawScore =
    social.score * W_SOCIAL +
    market.score * W_MARKET +
    execution.score * W_EXECUTION;

  const penalty = invalidation.score * W_INVALIDATION;
  const earlyPumpScore = clamp(Math.round(rawScore - penalty), 0, 100);

  // Collect all reasons
  const allReasons = [...social.reasons, ...market.reasons, ...execution.reasons, ...invalidation.reasons];

  // Collect verifiable source refs
  const refs: string[] = [];
  if (facts.taostats_source_url) refs.push(facts.taostats_source_url);
  if (facts.taoflute_source_ref) refs.push(facts.taoflute_source_ref);
  if (facts.social_source_refs?.length) refs.push(...facts.social_source_refs);

  // Determine tag
  let tag: EarlyPumpTag = null;

  const ch7d = facts.change_7d ?? 0;
  const ch24h = facts.change_24h ?? 0;
  const isPumpAdvanced = ch7d > LATE_MOMENTUM_CHANGE_7D || ch24h > LATE_MOMENTUM_CHANGE_24H;
  const hasExternalRisk = facts.external_status !== "NONE";
  const hasCriticalBlock = decision.final_action === "SORTIR" || decision.final_action === "ÉVITER";
  const hasSocialSignal = social.score >= 15;
  const hasMarketSignal = market.score >= 20;

  if (earlyPumpScore >= EARLY_PUMP_THRESHOLD) {
    if (isPumpAdvanced) {
      // Already advanced — "late momentum", not "early"
      tag = "LATE_MOMENTUM";
    } else if (hasCriticalBlock) {
      // Blocked by guardrails
      tag = null;
    } else if (hasExternalRisk) {
      // External risk present but score is high
      tag = "EARLY_PUMP_WATCH";
    } else {
      tag = "EARLY_PUMP_CANDIDATE";
    }
  } else if (earlyPumpScore >= 40 && isPumpAdvanced && hasMarketSignal) {
    // Lower threshold but pump is already happening
    tag = "LATE_MOMENTUM";
  }

  // Rule: social alone without market → no strong signal
  if (tag === "EARLY_PUMP_CANDIDATE" && !hasMarketSignal) {
    tag = "EARLY_PUMP_WATCH";
    allReasons.push("Social seul sans confirmation marché — signal atténué");
  }

  // Rule: market alone without minimal social → downgrade
  if (tag === "EARLY_PUMP_CANDIDATE" && !hasSocialSignal) {
    tag = "EARLY_PUMP_WATCH";
    allReasons.push("Marché actif sans validation sociale minimale — signal watch");
  }

  return {
    tag,
    early_pump_score: earlyPumpScore,
    social_acceleration_score: social.score,
    market_awakening_score: market.score,
    execution_viability_score: execution.score,
    invalidation_score: invalidation.score,
    reasons: allReasons,
    detected_at: now,
    source_refs: refs,
  };
}

/* ── Batch detection ── */

export function detectAllEarlyPumps(
  factsMap: Map<number, CanonicalSubnetFacts>,
  decisionsMap: Map<number, CanonicalSubnetDecision>,
): Map<number, EarlyPumpResult> {
  const results = new Map<number, EarlyPumpResult>();
  for (const [netuid, facts] of factsMap) {
    const decision = decisionsMap.get(netuid);
    if (!decision) continue;
    const result = detectEarlyPump(facts, decision);
    results.set(netuid, result);
  }
  return results;
}
