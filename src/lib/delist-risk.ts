/* ═══════════════════════════════════════ */
/*   DELIST RISK ENGINE                      */
/*   Hybrid: Manual + Auto detection         */
/*   NO hardcoded scores — all computed      */
/* ═══════════════════════════════════════ */

import type { ScoreFactor } from "./score-factors";
import { topFactors } from "./score-factors";

export type DelistMode = "manual" | "auto_taostats" | "auto_taomarketcap";

export type DelistCategory = "DEPEG_PRIORITY" | "HIGH_RISK_NEAR_DELIST" | "NORMAL";

export type DelistRiskResult = {
  netuid: number;
  category: DelistCategory;
  score: number; // 0–100, always computed
  reasons: DelistReason[];
  factors: ScoreFactor[]; // top-3 contributing factors
  source: string;
};

export type DelistReason = {
  code: string;
  label: string;
  labelFr: string;
  weight: number;
  value?: number;
  color: string;
};

/* ─── MANUAL LISTS (Taoflute baseline — updated from validated screenshots 2026-03) ─── */

export const DEPEG_PRIORITY_MANUAL: number[] = [70, 82, 55, 57, 102, 84, 79, 66, 78, 128];
export const HIGH_RISK_NEAR_DELIST_MANUAL: number[] = [126, 87, 80, 91, 94, 96, 109, 31, 47, 99, 108, 38, 97, 114, 107, 113, 92];

/* ─── WHITELISTED (never delist) ─── */
const WHITELIST = new Set([0]); // Root subnet

/* ─── REASON DEFINITIONS ─── */
const REASON_DEFS: Record<string, Omit<DelistReason, "value" | "weight"> & { weight: number }> = {
  EMISSION_ZERO:       { code: "EMISSION_ZERO",       label: "Emission drop",       labelFr: "Émission nulle",       weight: 20, color: "rgba(229,57,53,0.8)" },
  EMISSION_LOW:        { code: "EMISSION_LOW",        label: "Low emission",         labelFr: "Émission faible",      weight: 10, color: "rgba(255,152,0,0.8)" },
  UID_CRITICAL:        { code: "UID_CRITICAL",        label: "UID critical",         labelFr: "UID critique",         weight: 18, color: "rgba(229,57,53,0.8)" },
  UID_LOW:             { code: "UID_LOW",             label: "UID low",              labelFr: "UID faible",           weight: 10, color: "rgba(255,193,7,0.8)" },
  POOL_COLLAPSE:       { code: "POOL_COLLAPSE",       label: "Pool collapse",        labelFr: "Pool en chute",        weight: 15, color: "rgba(229,57,53,0.8)" },
  POOL_THIN:           { code: "POOL_THIN",           label: "Pool thin",            labelFr: "Pool faible",          weight: 8,  color: "rgba(255,152,0,0.8)" },
  LIQ_CRITICAL:        { code: "LIQ_CRITICAL",        label: "Liquidity critical",   labelFr: "Liquidité critique",   weight: 15, color: "rgba(229,57,53,0.8)" },
  VOL_MC_LOW:          { code: "VOL_MC_LOW",          label: "Vol/MC abnormal",      labelFr: "Vol/MC anormal",       weight: 8,  color: "rgba(255,193,7,0.8)" },
  RANK_DROP:           { code: "RANK_DROP",           label: "Rank drop",            labelFr: "Chute de rang",        weight: 10, color: "rgba(255,152,0,0.8)" },
  PRICE_COLLAPSE:      { code: "PRICE_COLLAPSE",      label: "Price collapse",       labelFr: "Effondrement prix",    weight: 12, color: "rgba(229,57,53,0.9)" },
  DATA_DIVERGENCE:     { code: "DATA_DIVERGENCE",     label: "Extreme divergence",   labelFr: "Divergence extrême",   weight: 7,  color: "rgba(255,152,0,0.7)" },
  SLIPPAGE_HIGH:       { code: "SLIPPAGE_HIGH",       label: "Slippage high",        labelFr: "Slippage élevé",       weight: 8,  color: "rgba(229,57,53,0.7)" },
  SPREAD_HIGH:         { code: "SPREAD_HIGH",         label: "Spread high",          labelFr: "Spread élevé",         weight: 6,  color: "rgba(255,152,0,0.7)" },
  MICRO_PRICE:         { code: "MICRO_PRICE",         label: "Micro price",          labelFr: "Prix micro",           weight: 10, color: "rgba(229,57,53,0.85)" },
  CAP_CONCENTRATED:    { code: "CAP_CONCENTRATED",    label: "Cap = Pool",           labelFr: "Cap ≈ Pool",           weight: 6,  color: "rgba(255,152,0,0.8)" },
  SMALL_CAP:           { code: "SMALL_CAP",           label: "Small cap",            labelFr: "Cap faible",           weight: 5,  color: "rgba(255,193,7,0.8)" },
  MANUAL_FLAG:         { code: "MANUAL_FLAG",         label: "Manual watchlist",     labelFr: "Liste manuelle",       weight: 10, color: "rgba(229,57,53,0.7)" },
};

function makeReason(code: string, value?: number): DelistReason {
  const def = REASON_DEFS[code];
  return { ...def, value };
}

function makeFactor(code: string, contribution: number, rawValue?: number): ScoreFactor {
  const def = REASON_DEFS[code];
  return { code, label: def?.labelFr ?? code, contribution, rawValue };
}

/* ─── AUTO DELIST RISK SCORE ─── */

export type SubnetMetricsForDelist = {
  netuid: number;
  minersActive: number;
  liqTao: number;
  liqUsd: number;
  capTao: number;
  alphaPrice: number;
  volMcRatio: number;
  psi: number;
  quality: number;
  state: string | null;
  priceChange7d: number | null;
  confianceData: number;
  liqHaircut: number;
};

/**
 * Compute delist risk score (0–100) based on on-chain/market metrics.
 * Higher score = higher delist risk. ALL scores are computed, never hardcoded.
 */
export function computeDelistRiskScore(sn: SubnetMetricsForDelist): DelistRiskResult {
  if (WHITELIST.has(sn.netuid)) {
    return { netuid: sn.netuid, category: "NORMAL", score: 0, reasons: [], factors: [], source: "" };
  }

  const reasons: DelistReason[] = [];
  const factors: ScoreFactor[] = [];
  let totalWeight = 0;

  // 1. Emission / miners
  if (sn.minersActive === 0) {
    const w = 20;
    reasons.push(makeReason("EMISSION_ZERO", 0));
    factors.push(makeFactor("EMISSION_ZERO", w, 0));
    totalWeight += w;
  } else if (sn.minersActive <= 5) {
    const w = 18;
    reasons.push(makeReason("UID_CRITICAL", sn.minersActive));
    factors.push(makeFactor("UID_CRITICAL", w, sn.minersActive));
    totalWeight += w;
  } else if (sn.minersActive <= 20) {
    const w = 12;
    reasons.push(makeReason("UID_LOW", sn.minersActive));
    factors.push(makeFactor("UID_LOW", w, sn.minersActive));
    totalWeight += w;
  }

  // 2. Pool TAO
  if (sn.liqTao < 10) {
    const w = 18;
    reasons.push(makeReason("POOL_COLLAPSE", sn.liqTao));
    factors.push(makeFactor("POOL_COLLAPSE", w, sn.liqTao));
    totalWeight += w;
  } else if (sn.liqTao < 50) {
    const w = 10;
    reasons.push(makeReason("POOL_THIN", sn.liqTao));
    factors.push(makeFactor("POOL_THIN", w, sn.liqTao));
    totalWeight += w;
  }

  // 3. Liquidity USD — only critical if very low
  if (sn.liqUsd < 2000) {
    const w = 15;
    reasons.push(makeReason("LIQ_CRITICAL", sn.liqUsd));
    factors.push(makeFactor("LIQ_CRITICAL", w, sn.liqUsd));
    totalWeight += w;
  }

  // 4. Volume/MC abnormally low
  if (sn.volMcRatio < 0.01) {
    const w = 10;
    reasons.push(makeReason("VOL_MC_LOW", sn.volMcRatio * 100));
    factors.push(makeFactor("VOL_MC_LOW", w, sn.volMcRatio));
    totalWeight += w;
  }

  // 5. Price collapse over 7d
  if (sn.priceChange7d != null && sn.priceChange7d <= -20) {
    const w = sn.priceChange7d <= -50 ? 15 : 12;
    reasons.push(makeReason("PRICE_COLLAPSE", sn.priceChange7d));
    factors.push(makeFactor("PRICE_COLLAPSE", w, sn.priceChange7d));
    totalWeight += w;
  }

  // 7. Liquidity haircut severe
  if (sn.liqHaircut <= -20) {
    const w = sn.liqHaircut <= -50 ? 15 : 10;
    reasons.push(makeReason("POOL_COLLAPSE", sn.liqHaircut));
    factors.push(makeFactor("POOL_COLLAPSE", w, sn.liqHaircut));
    totalWeight += w;
  }

  // 8. BREAK/EXIT_FAST/DEPEG state
  if (sn.state === "BREAK" || sn.state === "EXIT_FAST") {
    totalWeight += 10;
    factors.push(makeFactor("BREAK_STATE", 10));
  } else if (sn.state === "DEPEG_WARNING" || sn.state === "DEPEG_CRITICAL") {
    totalWeight += 15;
    factors.push(makeFactor("DEPEG", 15));
  }

  // 9. PSI overheating + low quality
  if (sn.psi > 75 && sn.quality < 35) {
    const w = 10;
    reasons.push(makeReason("SLIPPAGE_HIGH", sn.psi));
    factors.push(makeFactor("SLIPPAGE_HIGH", w, sn.psi));
    totalWeight += w;
  }

  // 10. Combined weakness: low quality + low PSI = zombie subnet
  if (sn.psi < 30 && sn.quality < 30) {
    totalWeight += 8;
    factors.push(makeFactor("UID_LOW", 8, sn.psi));
  }

  // 11. Micro price
  if (sn.alphaPrice > 0 && sn.alphaPrice < 0.003) {
    const w = 15;
    reasons.push(makeReason("MICRO_PRICE", sn.alphaPrice));
    factors.push(makeFactor("MICRO_PRICE", w, sn.alphaPrice));
    totalWeight += w;
  } else if (sn.alphaPrice > 0 && sn.alphaPrice < 0.005) {
    const w = 10;
    reasons.push(makeReason("MICRO_PRICE", sn.alphaPrice));
    factors.push(makeFactor("MICRO_PRICE", w, sn.alphaPrice));
    totalWeight += w;
  }

  // 12. Cap concentration
  if (sn.capTao > 0 && sn.liqTao > 0) {
    const liqCapRatio = sn.liqTao / sn.capTao;
    if (liqCapRatio > 0.90) {
      const w = 12;
      reasons.push(makeReason("CAP_CONCENTRATED", Math.round(liqCapRatio * 100)));
      factors.push(makeFactor("CAP_CONCENTRATED", w, liqCapRatio));
      totalWeight += w;
    } else if (liqCapRatio > 0.80) {
      const w = 8;
      reasons.push(makeReason("CAP_CONCENTRATED", Math.round(liqCapRatio * 100)));
      factors.push(makeFactor("CAP_CONCENTRATED", w, liqCapRatio));
      totalWeight += w;
    }
  }

  // 13. Small cap
  if (sn.capTao > 0 && sn.capTao < 5_000) {
    const w = 10;
    reasons.push(makeReason("SMALL_CAP", Math.round(sn.capTao)));
    factors.push(makeFactor("SMALL_CAP", w, sn.capTao));
    totalWeight += w;
  } else if (sn.capTao > 0 && sn.capTao < 15_000) {
    const w = 6;
    reasons.push(makeReason("SMALL_CAP", Math.round(sn.capTao)));
    factors.push(makeFactor("SMALL_CAP", w, sn.capTao));
    totalWeight += w;
  }

  // Score: clamp to 0–100
  const score = Math.min(100, Math.round(totalWeight));

  // Category — raised threshold: 45 (was 35) to avoid false positives on active subnets
  let category: DelistCategory = "NORMAL";
  if (score >= 65) category = "DEPEG_PRIORITY";
  else if (score >= 45) category = "HIGH_RISK_NEAR_DELIST";

  return { netuid: sn.netuid, category, score, reasons, factors: topFactors(factors), source: "" };
}

/* ─── MANUAL MODE ─── */

/**
 * Manual mode: always compute auto score.
 * Manual lists only BOOST the category — they never impose a hardcoded score.
 * The manual flag adds a fixed bonus to the computed score.
 */
const MANUAL_DEPEG_BONUS = 15;
const MANUAL_HIGH_RISK_BONUS = 8;

function getManualResult(netuid: number, metrics?: SubnetMetricsForDelist): DelistRiskResult | null {
  if (WHITELIST.has(netuid)) return null;

  const isDepeg = DEPEG_PRIORITY_MANUAL.includes(netuid);
  const isHighRisk = HIGH_RISK_NEAR_DELIST_MANUAL.includes(netuid);
  if (!isDepeg && !isHighRisk) return null;

  // Always compute the real score from metrics
  if (metrics) {
    const auto = computeDelistRiskScore(metrics);
    const bonus = isDepeg ? MANUAL_DEPEG_BONUS : MANUAL_HIGH_RISK_BONUS;
    const boostedScore = Math.min(100, auto.score + bonus);
    const manualFactor: ScoreFactor = {
      code: "MANUAL_FLAG",
      label: isDepeg ? "Watchlist depeg" : "Watchlist risque",
      contribution: bonus,
    };
    const category: DelistCategory = boostedScore >= 65 ? "DEPEG_PRIORITY" :
      boostedScore >= 35 ? "HIGH_RISK_NEAR_DELIST" : "NORMAL";
    return {
      netuid,
      category: isDepeg ? "DEPEG_PRIORITY" : (category === "NORMAL" ? "HIGH_RISK_NEAR_DELIST" : category),
      score: boostedScore,
      reasons: auto.reasons.length > 0 ? auto.reasons : [makeReason("RANK_DROP")],
      factors: topFactors([...auto.factors, manualFactor]),
      source: "Manual (Taoflute)",
    };
  }

  // Fallback without metrics: minimal score based on category floor
  const fallbackScore = isDepeg ? 55 : 35;
  return {
    netuid,
    category: isDepeg ? "DEPEG_PRIORITY" : "HIGH_RISK_NEAR_DELIST",
    score: fallbackScore,
    reasons: [makeReason("RANK_DROP")],
    factors: [{ code: "MANUAL_FLAG", label: "Liste manuelle (pas de métriques)", contribution: fallbackScore }],
    source: "Manual (Taoflute)",
  };
}

/* ─── MAIN ENTRY POINT ─── */

/**
 * Get delist risk for all subnets.
 * In manual mode: computes auto score + manual bonus.
 * In auto mode: computes from metrics only.
 */
export function evaluateAllDelistRisks(
  mode: DelistMode,
  subnets: SubnetMetricsForDelist[],
): DelistRiskResult[] {
  const results: DelistRiskResult[] = [];

  if (mode === "manual") {
    // Manual: compute auto score + manual bonus for flagged subnets
    const metricsMap = new Map(subnets.map(sn => [sn.netuid, sn]));
    const allFlagged = new Set([...DEPEG_PRIORITY_MANUAL, ...HIGH_RISK_NEAR_DELIST_MANUAL]);
    for (const netuid of allFlagged) {
      const metrics = metricsMap.get(netuid);
      const result = getManualResult(netuid, metrics ?? undefined);
      if (result) results.push(result);
    }
  } else {
    const sourceLabel = mode === "auto_taostats" ? "Auto (Taostats)" : "Auto (TaoMarketCap)";
    for (const sn of subnets) {
      const result = computeDelistRiskScore(sn);
      if (result.category !== "NORMAL") {
        result.source = sourceLabel;
        results.push(result);
      }
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ─── SCORING COHERENCE HELPERS ─── */

/** Check if a subnet is in depeg/delist watchlist */
export function isDepegOrDelist(netuid: number, delistResults: DelistRiskResult[]): DelistRiskResult | undefined {
  return delistResults.find(r => r.netuid === netuid);
}

/** Get category color */
export function delistCategoryColor(cat: DelistCategory): string {
  switch (cat) {
    case "DEPEG_PRIORITY": return "rgba(229,57,53,0.9)";
    case "HIGH_RISK_NEAR_DELIST": return "rgba(255,152,0,0.85)";
    case "NORMAL": return "rgba(158,158,158,0.5)";
  }
}

/** Get category label — contextual wording based on source */
export function delistCategoryLabel(cat: DelistCategory, fr: boolean, isExternalWatch = false): string {
  switch (cat) {
    case "DEPEG_PRIORITY": return fr ? "🔴 RISQUE DEREG" : "🔴 DEREG RISK";
    case "HIGH_RISK_NEAR_DELIST":
      if (isExternalWatch) return fr ? "🟠 WATCH EXTERNE" : "🟠 EXTERNAL WATCH";
      return fr ? "🟠 STRUCTURE FRAGILE" : "🟠 FRAGILE STRUCTURE";
    case "NORMAL": return "Normal";
  }
}
