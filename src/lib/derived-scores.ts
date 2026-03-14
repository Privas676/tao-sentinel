/* ═══════════════════════════════════════════════════════ */
/*   DERIVED SCORES — Layer B: Feature Scoring            */
/*   Computes all derived scores from SubnetFacts.        */
/*   Includes PROHIBITION RULES that prevent incoherent   */
/*   score combinations.                                  */
/* ═══════════════════════════════════════════════════════ */

import type { SubnetFacts } from "./subnet-facts";
import { val } from "./subnet-facts";
import type { ConcordanceResult } from "./source-concordance";
import { clamp } from "./gauge-types";

/* ─── Types ─── */

export type DerivedScores = {
  marketStrength: number;        // 0-100
  momentum: number;              // 0-100
  liquidityQuality: number;      // 0-100
  executionQuality: number;      // 0-100
  structuralFragility: number;   // 0-100 (higher = more fragile = worse)
  concentrationRisk: number;     // 0-100 (higher = worse)
  depegRisk: number;             // 0-100
  delistRisk: number;            // 0-100
  smartMoney: number;            // 0-100
  conviction: number;            // 0-100
  confidence: number;            // 0-100
  volatility: number;            // 0-100
  dataConfidence: number;        // 0-100
  sourceConcordance: number;     // 0-100 (from concordance engine)
};

export type ProhibitionViolation = {
  code: string;
  message: string;
  /** Which score was capped */
  scoreCapped: keyof DerivedScores;
  /** Original value before capping */
  originalValue: number;
  /** Capped value */
  cappedValue: number;
};

export type ScoringResult = {
  scores: DerivedScores;
  violations: ProhibitionViolation[];
  /** Short explanation for each score */
  explanations: Record<keyof DerivedScores, string>;
};

/* ─── Individual score computations ─── */

function computeMarketStrength(f: SubnetFacts): { score: number; explanation: string } {
  const mc = val(f.marketCap);
  const vol = val(f.vol24h);
  const buys = val(f.buyCount);
  const sells = val(f.sellCount);

  let score = 50;

  // Market cap contribution
  if (mc > 100) score += 15;
  else if (mc > 10) score += 5;
  else score -= 15;

  // Volume relative to MC
  if (mc > 0) {
    const volRatio = vol / mc;
    if (volRatio > 0.01 && volRatio < 0.2) score += 15;
    else if (volRatio >= 0.2) score += 5; // excessive volume is suspicious
    else score -= 10;
  }

  // Buy/sell pressure
  const total = buys + sells;
  if (total > 0) {
    const buyRatio = buys / total;
    if (buyRatio > 0.6) score += 10;
    else if (buyRatio < 0.3) score -= 10;
  }

  return { score: clamp(score, 0, 100), explanation: `MC: ${mc.toFixed(1)}τ, Vol: ${vol.toFixed(2)}τ, B/S: ${buys}/${sells}` };
}

function computeMomentum(f: SubnetFacts): { score: number; explanation: string } {
  const ch1h = val(f.priceChange1h);
  const ch24h = val(f.priceChange24h);
  const ch7d = val(f.priceChange7d);
  const ch30d = val(f.priceChange30d);

  // Weighted momentum from multiple timeframes
  // Higher weight on 7d (most relevant for decisions)
  let score = 50;

  // 1h: quick signal
  if (ch1h > 3) score += 5;
  else if (ch1h < -3) score -= 5;

  // 24h: short-term trend
  if (ch24h > 10) score += 12;
  else if (ch24h > 5) score += 8;
  else if (ch24h > 0) score += 3;
  else if (ch24h < -10) score -= 12;
  else if (ch24h < -5) score -= 8;
  else if (ch24h < 0) score -= 3;

  // 7d: primary momentum signal
  if (ch7d > 20) score += 18;
  else if (ch7d > 10) score += 12;
  else if (ch7d > 5) score += 6;
  else if (ch7d > 0) score += 2;
  else if (ch7d < -20) score -= 18;
  else if (ch7d < -10) score -= 12;
  else if (ch7d < -5) score -= 6;
  else if (ch7d < 0) score -= 2;

  // 30d: structural trend
  if (ch30d > 30) score += 10;
  else if (ch30d > 10) score += 5;
  else if (ch30d < -30) score -= 10;
  else if (ch30d < -10) score -= 5;

  return {
    score: clamp(score, 0, 100),
    explanation: `1h: ${ch1h.toFixed(1)}%, 24h: ${ch24h.toFixed(1)}%, 7j: ${ch7d.toFixed(1)}%, 30j: ${ch30d.toFixed(1)}%`,
  };
}

function computeLiquidityQuality(f: SubnetFacts): { score: number; explanation: string } {
  const taoPool = val(f.taoInPool);
  const haircut = Math.abs(val(f.liqHaircut));
  const slippage1 = val(f.slippage1tau);
  const slippage10 = val(f.slippage10tau);
  const spread = val(f.spread);
  const mc = val(f.marketCap);

  let score = 50;

  // Pool depth
  if (taoPool > 500) score += 20;
  else if (taoPool > 100) score += 10;
  else if (taoPool > 10) score += 0;
  else score -= 20;

  // Haircut penalty (CRITICAL — key prohibition trigger)
  if (haircut > 30) score -= 25;
  else if (haircut > 15) score -= 15;
  else if (haircut > 5) score -= 5;

  // Slippage quality
  if (slippage10 < 1) score += 10;
  else if (slippage10 < 5) score += 5;
  else if (slippage10 > 20) score -= 15;
  else if (slippage10 > 10) score -= 8;

  // Liquidity/MC ratio
  if (mc > 0 && taoPool > 0) {
    const ratio = taoPool / mc;
    if (ratio > 0.05) score += 5;
    else if (ratio < 0.005) score -= 10;
  }

  return {
    score: clamp(score, 0, 100),
    explanation: `Pool: ${taoPool.toFixed(1)}τ, Haircut: ${haircut.toFixed(1)}%, Slip10τ: ${slippage10.toFixed(1)}%, Spread: ${spread.toFixed(2)}%`,
  };
}

function computeExecutionQuality(f: SubnetFacts): { score: number; explanation: string } {
  const slippage1 = val(f.slippage1tau);
  const slippage10 = val(f.slippage10tau);
  const spread = val(f.spread);
  const haircut = Math.abs(val(f.liqHaircut));

  let score = 60;

  if (slippage1 < 0.5) score += 15;
  else if (slippage1 < 2) score += 5;
  else if (slippage1 > 5) score -= 15;
  else if (slippage1 > 3) score -= 8;

  if (spread < 0.1) score += 10;
  else if (spread > 1) score -= 15;
  else if (spread > 0.5) score -= 8;

  if (haircut > 20) score -= 15;
  else if (haircut > 10) score -= 8;

  return {
    score: clamp(score, 0, 100),
    explanation: `Slip1τ: ${slippage1.toFixed(2)}%, Spread: ${spread.toFixed(2)}%, Haircut: ${haircut.toFixed(1)}%`,
  };
}

function computeStructuralFragility(f: SubnetFacts): { score: number; explanation: string } {
  const validators = val(f.validators);
  const miners = val(f.miners);
  const uidSat = val(f.uidSaturation);
  const rootProp = val(f.rootProportion);
  const emission = val(f.emissionPerDay);

  // Higher = more fragile = worse
  let fragility = 20; // baseline

  if (validators < 3) fragility += 25;
  else if (validators < 8) fragility += 10;

  if (miners <= 1) fragility += 25;
  else if (miners < 5) fragility += 10;

  if (uidSat < 0.1) fragility += 15;
  else if (uidSat > 0.95) fragility += 5; // over-saturated

  if (rootProp > 0.99) fragility += 15;
  else if (rootProp > 0.95) fragility += 8;

  if (emission === 0) fragility += 10;

  return {
    score: clamp(fragility, 0, 100),
    explanation: `Val: ${validators}, Min: ${miners}, UID: ${(uidSat * 100).toFixed(0)}%, Root: ${(rootProp * 100).toFixed(1)}%`,
  };
}

function computeConcentrationRisk(f: SubnetFacts): { score: number; explanation: string } {
  const validators = val(f.validators);
  const miners = val(f.miners);
  const rootProp = val(f.rootProportion);

  let risk = 20;
  if (validators < 5) risk += 20;
  if (miners <= 1) risk += 25;
  else if (miners < 3) risk += 15;
  if (rootProp > 0.95) risk += 20;

  return {
    score: clamp(risk, 0, 100),
    explanation: `Val: ${validators}, Min: ${miners}, Root: ${(rootProp * 100).toFixed(1)}%`,
  };
}

function computeDepegRisk(f: SubnetFacts): { score: number; explanation: string } {
  const haircut = Math.abs(val(f.liqHaircut));
  const slippage10 = val(f.slippage10tau);
  const taoPool = val(f.taoInPool);

  let risk = 10;
  if (haircut > 30) risk += 30;
  else if (haircut > 15) risk += 15;
  if (slippage10 > 20) risk += 20;
  else if (slippage10 > 10) risk += 10;
  if (taoPool < 5) risk += 20;
  else if (taoPool < 20) risk += 10;

  return {
    score: clamp(risk, 0, 100),
    explanation: `Haircut: ${haircut.toFixed(1)}%, Slip10τ: ${slippage10.toFixed(1)}%, Pool: ${taoPool.toFixed(1)}τ`,
  };
}

function computeDelistRisk(f: SubnetFacts): { score: number; explanation: string } {
  const validators = val(f.validators);
  const miners = val(f.miners);
  const emission = val(f.emissionPerDay);
  const uidSat = val(f.uidSaturation);
  const rootProp = val(f.rootProportion);
  const registrations = val(f.registrations);

  let risk = 5;
  if (miners <= 1) risk += 25;
  if (validators < 2) risk += 20;
  if (emission === 0 && uidSat < 0.1) risk += 20;
  if (rootProp > 0.99) risk += 15;
  if (registrations === 0 && miners <= 1) risk += 10;

  return {
    score: clamp(risk, 0, 100),
    explanation: `Min: ${miners}, Val: ${validators}, Em: ${emission.toFixed(4)}, UID: ${(uidSat * 100).toFixed(0)}%`,
  };
}

function computeSmartMoney(f: SubnetFacts): { score: number; explanation: string } {
  const buys = val(f.buyCount);
  const sells = val(f.sellCount);
  const buyers = val(f.buyerCount);
  const sellers = val(f.sellerCount);
  const vol = val(f.vol24h);

  let score = 50;

  // Buy pressure indicator
  if (buys + sells > 0) {
    const buyRatio = buys / (buys + sells);
    score += (buyRatio - 0.5) * 40;
  }

  // Unique buyers vs sellers
  if (buyers + sellers > 0) {
    const uniqueBuyRatio = buyers / (buyers + sellers);
    score += (uniqueBuyRatio - 0.5) * 20;
  }

  // Volume presence
  if (vol > 0) score += 5;

  return { score: clamp(Math.round(score), 0, 100), explanation: `Buys: ${buys}, Sells: ${sells}, Buyers: ${buyers}, Sellers: ${sellers}` };
}

function computeVolatility(f: SubnetFacts): { score: number; explanation: string } {
  const ch1h = Math.abs(val(f.priceChange1h));
  const ch24h = Math.abs(val(f.priceChange24h));
  const ch7d = Math.abs(val(f.priceChange7d));

  let vol = 20;
  if (ch1h > 10) vol += 20;
  else if (ch1h > 5) vol += 10;
  if (ch24h > 20) vol += 20;
  else if (ch24h > 10) vol += 10;
  if (ch7d > 40) vol += 15;
  else if (ch7d > 20) vol += 8;

  return { score: clamp(vol, 0, 100), explanation: `|1h|: ${ch1h.toFixed(1)}%, |24h|: ${ch24h.toFixed(1)}%, |7j|: ${ch7d.toFixed(1)}%` };
}

/* ─── PROHIBITION RULES ─── */
/* These rules prevent incoherent score combinations */

function applyProhibitions(
  scores: DerivedScores,
  facts: SubnetFacts,
  externalHaircut?: number | null,
): ProhibitionViolation[] {
  const violations: ProhibitionViolation[] = [];

  // Effective haircut: worst-case between local and external Taoflute
  const localHaircut = Math.abs(val(facts.liqHaircut));
  const extHaircut = externalHaircut != null ? Math.abs(externalHaircut) : 0;
  const effectiveHaircut = Math.max(localHaircut, extHaircut);

  // RULE 1: liquidity_score > 85 forbidden if haircut > 15% or liq_price very degraded
  if (scores.liquidityQuality > 85 && effectiveHaircut > 15) {
    const original = scores.liquidityQuality;
    scores.liquidityQuality = Math.min(scores.liquidityQuality, 60);
    violations.push({
      code: "LIQ_HAIRCUT_CAP",
      message: `Liquidité plafonnée: haircut effectif ${effectiveHaircut.toFixed(1)}% (local: ${localHaircut.toFixed(1)}%, ext: ${extHaircut.toFixed(1)}%)`,
      scoreCapped: "liquidityQuality",
      originalValue: original,
      cappedValue: scores.liquidityQuality,
    });
  }

  // RULE 1b: External haircut severe → force liquidity penalty even below threshold
  if (extHaircut > 25 && scores.liquidityQuality > 50) {
    const original = scores.liquidityQuality;
    scores.liquidityQuality = Math.min(scores.liquidityQuality, 40);
    violations.push({
      code: "LIQ_EXT_HAIRCUT_SEVERE",
      message: `Liquidité dégradée: haircut externe Taoflute ${extHaircut.toFixed(1)}% — signal de risque critique`,
      scoreCapped: "liquidityQuality",
      originalValue: original,
      cappedValue: scores.liquidityQuality,
    });
  }

  // RULE 1c: External haircut → depeg risk floor
  if (extHaircut > 20 && scores.depegRisk < 40) {
    const original = scores.depegRisk;
    scores.depegRisk = Math.max(scores.depegRisk, 45);
    violations.push({
      code: "DEPEG_EXT_HAIRCUT_FLOOR",
      message: `Risque depeg relevé: haircut externe ${extHaircut.toFixed(1)}% détecté par Taoflute`,
      scoreCapped: "depegRisk",
      originalValue: original,
      cappedValue: scores.depegRisk,
    });
  }

  // RULE 1d: External haircut → execution quality cap
  if (extHaircut > 15 && scores.executionQuality > 60) {
    const original = scores.executionQuality;
    scores.executionQuality = Math.min(scores.executionQuality, 45);
    violations.push({
      code: "EXEC_EXT_HAIRCUT_CAP",
      message: `Exécution plafonnée: haircut externe ${extHaircut.toFixed(1)}% — conditions de marché dégradées`,
      scoreCapped: "executionQuality",
      originalValue: original,
      cappedValue: scores.executionQuality,
    });
  }

  // RULE 2: structure high forbidden if miners <= 1 or extreme concentration
  if (scores.structuralFragility < 30 && (val(facts.miners) <= 1 || scores.concentrationRisk > 70)) {
    const original = scores.structuralFragility;
    scores.structuralFragility = Math.max(scores.structuralFragility, 60);
    violations.push({
      code: "STRUCTURE_MINER_CAP",
      message: `Fragilité structurelle forcée: miners ${val(facts.miners)}, concentration ${scores.concentrationRisk}`,
      scoreCapped: "structuralFragility",
      originalValue: original,
      cappedValue: scores.structuralFragility,
    });
  }

  // RULE 3: momentum cannot be 0 if external variations are strongly positive
  const ch7d = val(facts.priceChange7d);
  const ch24h = val(facts.priceChange24h);
  if (scores.momentum < 20 && (ch7d > 15 || ch24h > 10)) {
    const original = scores.momentum;
    scores.momentum = Math.max(scores.momentum, 45);
    violations.push({
      code: "MOMENTUM_FLOOR",
      message: `Momentum relevé: variations externes positives (7j: ${ch7d.toFixed(1)}%, 24h: ${ch24h.toFixed(1)}%)`,
      scoreCapped: "momentum",
      originalValue: original,
      cappedValue: scores.momentum,
    });
  }

  // RULE 4: momentum cannot be high if external variations are strongly negative
  if (scores.momentum > 70 && (ch7d < -15 || ch24h < -10)) {
    const original = scores.momentum;
    scores.momentum = Math.min(scores.momentum, 45);
    violations.push({
      code: "MOMENTUM_CEILING",
      message: `Momentum plafonné: variations négatives (7j: ${ch7d.toFixed(1)}%, 24h: ${ch24h.toFixed(1)}%)`,
      scoreCapped: "momentum",
      originalValue: original,
      cappedValue: scores.momentum,
    });
  }

  // RULE 5: conviction must be low if concordance is low
  if (scores.conviction > 70 && scores.sourceConcordance < 40) {
    const original = scores.conviction;
    scores.conviction = Math.min(scores.conviction, 40);
    violations.push({
      code: "CONVICTION_CONCORDANCE_CAP",
      message: `Conviction plafonnée: concordance faible (${scores.sourceConcordance})`,
      scoreCapped: "conviction",
      originalValue: original,
      cappedValue: scores.conviction,
    });
  }

  // RULE 6: execution quality capped if slippage is extreme
  const slippage10 = val(facts.slippage10tau);
  if (scores.executionQuality > 70 && slippage10 > 10) {
    const original = scores.executionQuality;
    scores.executionQuality = Math.min(scores.executionQuality, 45);
    violations.push({
      code: "EXECUTION_SLIPPAGE_CAP",
      message: `Exécution plafonnée: slippage 10τ ${slippage10.toFixed(1)}%`,
      scoreCapped: "executionQuality",
      originalValue: original,
      cappedValue: scores.executionQuality,
    });
  }

  return violations;
}

/* ─── Main scoring function ─── */

export function computeDerivedScores(
  facts: SubnetFacts,
  concordance: ConcordanceResult,
  externalHaircut?: number | null,
): ScoringResult {
  const ms = computeMarketStrength(facts);
  const mom = computeMomentum(facts);
  const liq = computeLiquidityQuality(facts);
  const exec = computeExecutionQuality(facts);
  const frag = computeStructuralFragility(facts);
  const conc = computeConcentrationRisk(facts);
  const dpeg = computeDepegRisk(facts);
  const delist = computeDelistRisk(facts);
  const sm = computeSmartMoney(facts);
  const vol = computeVolatility(facts);

  // Conviction: derived from momentum + market strength + liquidity - risk
  const convictionRaw = (ms.score * 0.25 + mom.score * 0.35 + liq.score * 0.20 + (100 - frag.score) * 0.20);

  // Confidence: data quality + concordance
  const confRaw = concordance.score;

  const scores: DerivedScores = {
    marketStrength: ms.score,
    momentum: mom.score,
    liquidityQuality: liq.score,
    executionQuality: exec.score,
    structuralFragility: frag.score,
    concentrationRisk: conc.score,
    depegRisk: dpeg.score,
    delistRisk: delist.score,
    smartMoney: sm.score,
    conviction: clamp(Math.round(convictionRaw), 0, 100),
    confidence: clamp(Math.round(confRaw), 0, 100),
    volatility: vol.score,
    dataConfidence: concordance.score,
    sourceConcordance: concordance.score,
  };

  // Apply prohibition rules (mutates scores in place)
  const violations = applyProhibitions(scores, facts, externalHaircut);

  const explanations: Record<keyof DerivedScores, string> = {
    marketStrength: ms.explanation,
    momentum: mom.explanation,
    liquidityQuality: liq.explanation,
    executionQuality: exec.explanation,
    structuralFragility: frag.explanation,
    concentrationRisk: conc.explanation,
    depegRisk: dpeg.explanation,
    delistRisk: delist.explanation,
    smartMoney: sm.explanation,
    conviction: `Composite: market ${ms.score}, mom ${mom.score}, liq ${liq.score}, struct ${100 - frag.score}`,
    confidence: `Concordance: ${concordance.score}/100 (${concordance.grade})`,
    volatility: vol.explanation,
    dataConfidence: `Grade ${concordance.grade}, ${concordance.failedChecks.length} checks failed`,
    sourceConcordance: `${concordance.checks.length} checks, ${concordance.failedChecks.length} failed`,
  };

  return { scores, violations, explanations };
}

/* ─── Batch ─── */

export function computeAllDerivedScores(
  factsMap: Map<number, SubnetFacts>,
  concordanceMap: Map<number, ConcordanceResult>,
  externalHaircuts?: Map<number, number | null>,
): Map<number, ScoringResult> {
  const result = new Map<number, ScoringResult>();
  for (const [netuid, facts] of factsMap) {
    const concordance = concordanceMap.get(netuid);
    if (concordance) {
      const extHaircut = externalHaircuts?.get(netuid) ?? null;
      result.set(netuid, computeDerivedScores(facts, concordance, extHaircut));
    }
  }
  return result;
}
