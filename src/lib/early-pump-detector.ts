/* ═══════════════════════════════════════════════════════════ */
/*   PUMP DETECTOR — Two distinct detectors:                   */
/*   1. EARLY_PUMP_CANDIDATE — emerging before the crowd       */
/*   2. LATE_PUMP / OVEREXTENDED — already too advanced        */
/*   NO mock data — purely derived from canonical facts +      */
/*   canonical decisions.                                      */
/* ═══════════════════════════════════════════════════════════ */

import type { CanonicalSubnetFacts } from "./canonical-types";
import type { CanonicalSubnetDecision } from "./canonical-types";
import { clamp } from "./gauge-types";

/* ── Types ── */

export type EarlyPumpTag =
  | "EARLY_PUMP_CANDIDATE"   // emerging, no critical block
  | "EARLY_PUMP_WATCH"       // emerging but external risk active
  | "LATE_PUMP"              // pump already too advanced / overheated
  | "OVEREXTENDED"           // extreme overextension, high revert risk
  | null;                    // no signal

export type EarlyPumpResult = {
  tag: EarlyPumpTag;
  early_pump_score: number;          // 0-100 composite (early detector)
  overextension_score: number;       // 0-100 composite (late detector)
  social_acceleration_score: number; // 0-100
  market_awakening_score: number;    // 0-100
  execution_viability_score: number; // 0-100
  invalidation_score: number;        // 0-100 (penalty)
  reasons: string[];
  detected_at: string;
  source_refs: string[];
};

/* ── Thresholds ── */
const EARLY_PUMP_THRESHOLD = 55;
const OVEREXTENDED_THRESHOLD = 65;
const LATE_PUMP_THRESHOLD = 50;

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
  const kolScore = f.social_kol_mentions ?? 0;
  const hypeScore = f.social_hype_score ?? 0;
  const signalStrength = f.social_signal_strength ?? 0;

  if (mentions >= 2) {
    score += 15;
    reasons.push(`${mentions} mentions sociales détectées`);
  }
  if (mentions >= 5) score += 10;

  if (uniqueAccounts >= 3) {
    score += 20;
    reasons.push(`${uniqueAccounts} comptes uniques — signal diversifié`);
  } else if (uniqueAccounts >= 2) {
    score += 10;
    reasons.push(`${uniqueAccounts} comptes uniques`);
  } else if (uniqueAccounts === 1 && mentions > 0) {
    score -= 10;
    reasons.push("Source unique — concentration sociale");
  }

  if (kolScore > 70) {
    score += 25;
    reasons.push(`KOL Tier A/B actif (score: ${kolScore})`);
  } else if (kolScore > 40) {
    score += 15;
    reasons.push(`Signal KOL modéré (score: ${kolScore})`);
  }

  if (hypeScore > 60) {
    score += 15;
    reasons.push(`Heat sociale élevée (${hypeScore})`);
  } else if (hypeScore > 30) {
    score += 8;
  }

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
    score += 5; // already extended
  }

  if (ch1h > 1 && ch1h <= 10) {
    score += 10;
    reasons.push(`Mouvement 1h: +${ch1h.toFixed(1)}%`);
  }

  if (ch7d > 5 && ch7d <= 40) {
    score += 15;
    reasons.push(`Tendance 7j émergente: +${ch7d.toFixed(1)}%`);
  }

  if (vol24h > 0.5) {
    score += 10;
    reasons.push(`Volume 24h: ${vol24h.toFixed(2)} τ`);
  }
  if (vol24h > 2) score += 5;

  if (buys > 3 && sentiment > 55) {
    score += 15;
    reasons.push(`Pression acheteuse: ${buys} achats, sentiment ${sentiment}%`);
  }

  if (buyers >= 3) {
    score += 10;
    reasons.push(`${buyers} acheteurs uniques`);
  }

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
  let score = 50;

  const liqScore = d.liquidity_quality_score;
  const execScore = d.execution_quality_score;
  const slippage = f.slippage_10tau ?? 100;
  const spread = f.spread ?? 100;
  const depth = f.depth ?? 0;

  if (liqScore > 60) {
    score += 20;
    reasons.push(`Liquidité correcte (${liqScore}/100)`);
  } else if (liqScore > 40) {
    score += 10;
  } else {
    score -= 15;
    reasons.push(`Liquidité faible (${liqScore}/100)`);
  }

  if (execScore > 60) score += 15;
  else if (execScore < 35) {
    score -= 15;
    reasons.push(`Exécution dégradée (${execScore}/100)`);
  }

  if (slippage < 5) {
    score += 10;
    reasons.push(`Slippage acceptable (${slippage.toFixed(1)}%)`);
  } else if (slippage > 15) {
    score -= 15;
    reasons.push(`Slippage excessif (${slippage.toFixed(1)}%)`);
  }

  if (spread < 0.5) score += 5;
  else if (spread > 2) {
    score -= 10;
    reasons.push(`Spread élevé (${spread.toFixed(2)}%)`);
  }

  if (depth > 50) score += 5;
  else if (depth < 5) {
    score -= 15;
    reasons.push(`Profondeur insuffisante (${depth.toFixed(1)} τ)`);
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   4. OVEREXTENSION SCORE (NEW)     */
/*   Detects late pump / overheated   */
/* ═══════════════════════════════════ */

function computeOverextension(
  f: CanonicalSubnetFacts,
  d: CanonicalSubnetDecision,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const ch1h = f.change_1h ?? 0;
  const ch24h = f.change_24h ?? 0;
  const ch7d = f.change_7d ?? 0;
  const slippage = f.slippage_10tau ?? 0;
  const spread = f.spread ?? 0;
  const hypeScore = f.social_hype_score ?? 0;

  // Extreme price rise = overextended
  if (ch24h > 40) {
    score += 30;
    reasons.push(`Hausse 24h extrême: +${ch24h.toFixed(1)}%`);
  } else if (ch24h > 25) {
    score += 20;
    reasons.push(`Hausse 24h forte: +${ch24h.toFixed(1)}%`);
  }

  if (ch7d > 80) {
    score += 25;
    reasons.push(`Expansion 7j massive: +${ch7d.toFixed(1)}%`);
  } else if (ch7d > 50) {
    score += 15;
    reasons.push(`Expansion 7j rapide: +${ch7d.toFixed(1)}%`);
  }

  if (ch1h > 15) {
    score += 15;
    reasons.push(`Spike 1h: +${ch1h.toFixed(1)}%`);
  }

  // Late social euphoria (high hype without early foundation)
  if (hypeScore > 70) {
    score += 15;
    reasons.push(`Euphorie sociale tardive (heat: ${hypeScore})`);
  }

  // Concentration too high
  if (d.concentration_risk_score > 60) {
    score += 15;
    reasons.push(`Concentration élevée (${d.concentration_risk_score}/100)`);
  }

  // Execution degradation under pump pressure
  if (slippage > 10) {
    score += 10;
    reasons.push(`Slippage dégradé sous pression (${slippage.toFixed(1)}%)`);
  }
  if (spread > 1.5) {
    score += 5;
    reasons.push(`Spread élargi (${spread.toFixed(2)}%)`);
  }

  // Structural fragility under expansion
  if (d.structural_fragility_score > 60) {
    score += 10;
    reasons.push(`Structure fragile sous expansion (${d.structural_fragility_score}/100)`);
  }

  // Momentum already maxed out (> 80 = likely topping)
  if (d.momentum_score > 80) {
    score += 10;
    reasons.push(`Momentum saturé (${d.momentum_score}/100)`);
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   5. INVALIDATION SCORE (MALUS)    */
/* ═══════════════════════════════════ */

function computeInvalidation(
  f: CanonicalSubnetFacts,
  d: CanonicalSubnetDecision,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const extStatus = f.external_status;
  if (extStatus.startsWith("P")) {
    score += 40;
    reasons.push(`TaoFlute Priority (${extStatus}) — risque delist majeur`);
  } else if (extStatus === "WATCH") {
    score += 20;
    reasons.push("TaoFlute WATCH — surveillance externe active");
  }

  if (d.delist_risk_score > 60) {
    score += 20;
    reasons.push(`Risque delist élevé (${d.delist_risk_score}/100)`);
  } else if (d.delist_risk_score > 30) {
    score += 10;
  }

  if (d.depeg_risk_score > 50) {
    score += 20;
    reasons.push(`Risque depeg (${d.depeg_risk_score}/100)`);
  } else if (d.depeg_risk_score > 25) {
    score += 10;
  }

  if (d.concentration_risk_score > 70) {
    score += 15;
    reasons.push(`Concentration extrême (${d.concentration_risk_score}/100)`);
  }

  if (d.structural_fragility_score > 70) {
    score += 15;
    reasons.push(`Structure fragile (${d.structural_fragility_score}/100)`);
  }

  if (d.guardrail_active && (d.final_action === "SORTIR" || d.final_action === "ÉVITER")) {
    score += 30;
    reasons.push("Garde-fou actif — verdict bloquant");
  }

  return { score: clamp(score, 0, 100), reasons };
}

/* ═══════════════════════════════════ */
/*   COMPOSITE SCORES & TAG           */
/* ═══════════════════════════════════ */

const W_SOCIAL = 0.25;
const W_MARKET = 0.35;
const W_EXECUTION = 0.20;
const W_INVALIDATION = 0.20;

export function detectEarlyPump(
  facts: CanonicalSubnetFacts,
  decision: CanonicalSubnetDecision,
): EarlyPumpResult {
  const now = new Date().toISOString();
  const empty: EarlyPumpResult = { tag: null, early_pump_score: 0, overextension_score: 0, social_acceleration_score: 0, market_awakening_score: 0, execution_viability_score: 0, invalidation_score: 0, reasons: [], detected_at: now, source_refs: [] };

  if (facts.subnet_id === 0) return empty;

  const social = computeSocialAcceleration(facts);
  const market = computeMarketAwakening(facts, decision);
  const execution = computeExecutionViability(facts, decision);
  const overext = computeOverextension(facts, decision);
  const invalidation = computeInvalidation(facts, decision);

  // ── Early pump composite ──
  const earlyRaw = social.score * W_SOCIAL + market.score * W_MARKET + execution.score * W_EXECUTION;
  const earlyPenalty = invalidation.score * W_INVALIDATION;
  const earlyPumpScore = clamp(Math.round(earlyRaw - earlyPenalty), 0, 100);

  // ── Overextension composite ──
  const overextensionScore = overext.score;

  // Collect reasons & refs
  const allReasons = [...social.reasons, ...market.reasons, ...execution.reasons, ...overext.reasons, ...invalidation.reasons];
  const refs: string[] = [];
  if (facts.taostats_source_url) refs.push(facts.taostats_source_url);
  if (facts.taoflute_source_ref) refs.push(facts.taoflute_source_ref);
  if (facts.social_source_refs?.length) refs.push(...facts.social_source_refs);

  // ── Determine tag — two independent detectors ──
  let tag: EarlyPumpTag = null;

  const hasExternalRisk = facts.external_status !== "NONE";
  const hasCriticalBlock = decision.final_action === "SORTIR" || decision.final_action === "ÉVITER";
  const hasSocialSignal = social.score >= 15;
  const hasMarketSignal = market.score >= 20;

  // DETECTOR 2: Late pump / overextended (checked FIRST — takes priority)
  if (overextensionScore >= OVEREXTENDED_THRESHOLD) {
    tag = "OVEREXTENDED";
    allReasons.push("Surchauffe détectée — risque de retour violent");
  } else if (overextensionScore >= LATE_PUMP_THRESHOLD) {
    tag = "LATE_PUMP";
    allReasons.push("Pump avancé — phase tardive");
  }

  // DETECTOR 1: Early pump (only if NOT already tagged as late/overextended)
  if (!tag && earlyPumpScore >= EARLY_PUMP_THRESHOLD) {
    if (hasCriticalBlock) {
      // Blocked by guardrails — no tag
      tag = null;
    } else if (hasExternalRisk) {
      tag = "EARLY_PUMP_WATCH";
    } else {
      tag = "EARLY_PUMP_CANDIDATE";
    }

    // Downgrade rules
    if (tag === "EARLY_PUMP_CANDIDATE" && !hasMarketSignal) {
      tag = "EARLY_PUMP_WATCH";
      allReasons.push("Social seul sans confirmation marché — signal atténué");
    }
    if (tag === "EARLY_PUMP_CANDIDATE" && !hasSocialSignal) {
      tag = "EARLY_PUMP_WATCH";
      allReasons.push("Marché actif sans validation sociale minimale — signal watch");
    }
  }

  // Safety: never tag EARLY if overextension is significant
  if ((tag === "EARLY_PUMP_CANDIDATE" || tag === "EARLY_PUMP_WATCH") && overextensionScore >= LATE_PUMP_THRESHOLD) {
    tag = "LATE_PUMP";
    allReasons.push("Reclassé LATE_PUMP — surextension détectée malgré signaux early");
  }

  return {
    tag,
    early_pump_score: earlyPumpScore,
    overextension_score: overextensionScore,
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
    results.set(netuid, detectEarlyPump(facts, decision));
  }
  return results;
}
