/* ═══════════════════════════════════════ */
/*   DELIST RISK ENGINE                      */
/*   Hybrid: Manual + Auto detection         */
/* ═══════════════════════════════════════ */

export type DelistMode = "manual" | "auto_taostats" | "auto_taomarketcap";

export type DelistCategory = "DEPEG_PRIORITY" | "HIGH_RISK_NEAR_DELIST" | "NORMAL";

export type DelistRiskResult = {
  netuid: number;
  category: DelistCategory;
  score: number; // 0–100
  reasons: DelistReason[];
  source: string; // "Manual (Taoflute)" | "Auto (Taostats)" | "Auto (TaoMarketCap)"
};

export type DelistReason = {
  code: string;
  label: string;
  labelFr: string;
  weight: number;
  value?: number;
  color: string;
};

/* ─── MANUAL LISTS (Taoflute baseline) ─── */

export const DEPEG_PRIORITY_MANUAL: number[] = [83, 96, 30, 57, 97, 40, 84, 79, 128, 118];
export const HIGH_RISK_NEAR_DELIST_MANUAL: number[] = [99, 109, 31, 86, 47, 67, 76, 90, 105, 15, 108, 38, 49, 114, 107, 113, 92, 126, 87, 80, 91, 94];

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
};

function makeReason(code: string, value?: number): DelistReason {
  const def = REASON_DEFS[code];
  return { ...def, value };
}

/* ─── AUTO DELIST RISK SCORE ─── */

export type SubnetMetricsForDelist = {
  netuid: number;
  minersActive: number;
  liqTao: number;         // TAO in pool
  liqUsd: number;         // liquidity in USD
  volMcRatio: number;     // vol_24h / cap
  psi: number;            // MPI/PSI score
  quality: number;        // quality score
  state: string | null;
  priceChange7d: number | null; // % change over 7 days
  confianceData: number;  // data confidence 0-100
  liqHaircut: number;     // % change in liq (negative = drop)
};

/**
 * Compute delist risk score (0–100) based on on-chain/market metrics.
 * Higher score = higher delist risk.
 */
export function computeDelistRiskScore(sn: SubnetMetricsForDelist): DelistRiskResult {
  if (WHITELIST.has(sn.netuid)) {
    return { netuid: sn.netuid, category: "NORMAL", score: 0, reasons: [], source: "" };
  }

  const reasons: DelistReason[] = [];
  let totalWeight = 0;

  // 1. Emission / miners = 0
  if (sn.minersActive === 0) {
    reasons.push(makeReason("EMISSION_ZERO", 0));
    totalWeight += 20;
  } else if (sn.minersActive <= 3) {
    reasons.push(makeReason("UID_CRITICAL", sn.minersActive));
    totalWeight += 18;
  } else if (sn.minersActive <= 10) {
    reasons.push(makeReason("UID_LOW", sn.minersActive));
    totalWeight += 10;
  }

  // 2. Pool TAO critical
  if (sn.liqTao < 2) {
    reasons.push(makeReason("POOL_COLLAPSE", sn.liqTao));
    totalWeight += 15;
  } else if (sn.liqTao < 5) {
    reasons.push(makeReason("POOL_THIN", sn.liqTao));
    totalWeight += 8;
  }

  // 3. Liquidity USD critical
  if (sn.liqUsd < 200) {
    reasons.push(makeReason("LIQ_CRITICAL", sn.liqUsd));
    totalWeight += 15;
  }

  // 4. Volume/MC abnormally low
  if (sn.volMcRatio < 0.003) {
    reasons.push(makeReason("VOL_MC_LOW", sn.volMcRatio * 100));
    totalWeight += 8;
  }

  // 5. Price collapse over 7d
  if (sn.priceChange7d != null && sn.priceChange7d <= -40) {
    reasons.push(makeReason("PRICE_COLLAPSE", sn.priceChange7d));
    totalWeight += 12;
  }

  // 6. Data divergence extreme (low confidence)
  if (sn.confianceData < 30) {
    reasons.push(makeReason("DATA_DIVERGENCE", sn.confianceData));
    totalWeight += 7;
  }

  // 7. Liquidity haircut severe
  if (sn.liqHaircut <= -50) {
    reasons.push(makeReason("POOL_COLLAPSE", sn.liqHaircut));
    totalWeight += 12;
  }

  // 8. BREAK/EXIT_FAST state
  if (sn.state === "BREAK" || sn.state === "EXIT_FAST") {
    totalWeight += 5;
  }

  // 9. PSI overheating + low quality
  if (sn.psi > 85 && sn.quality < 25) {
    reasons.push(makeReason("SLIPPAGE_HIGH", sn.psi));
    totalWeight += 8;
  }

  // Score: clamp to 0–100
  const score = Math.min(100, Math.round(totalWeight));

  // Category
  let category: DelistCategory = "NORMAL";
  if (score >= 80) category = "DEPEG_PRIORITY";
  else if (score >= 60) category = "HIGH_RISK_NEAR_DELIST";

  return { netuid: sn.netuid, category, score, reasons, source: "" };
}

/* ─── MANUAL MODE ─── */

function getManualResult(netuid: number): DelistRiskResult | null {
  if (WHITELIST.has(netuid)) return null;

  if (DEPEG_PRIORITY_MANUAL.includes(netuid)) {
    return {
      netuid,
      category: "DEPEG_PRIORITY",
      score: 90,
      reasons: [makeReason("RANK_DROP")],
      source: "Manual (Taoflute)",
    };
  }
  if (HIGH_RISK_NEAR_DELIST_MANUAL.includes(netuid)) {
    return {
      netuid,
      category: "HIGH_RISK_NEAR_DELIST",
      score: 70,
      reasons: [makeReason("RANK_DROP")],
      source: "Manual (Taoflute)",
    };
  }
  return null;
}

/* ─── MAIN ENTRY POINT ─── */

/**
 * Get delist risk for all subnets.
 * In manual mode: uses hardcoded lists.
 * In auto mode: computes from metrics.
 */
export function evaluateAllDelistRisks(
  mode: DelistMode,
  subnets: SubnetMetricsForDelist[],
): DelistRiskResult[] {
  const results: DelistRiskResult[] = [];

  if (mode === "manual") {
    // Manual: assign fixed scores from lists + compute auto scores as secondary info
    for (const sn of subnets) {
      const manual = getManualResult(sn.netuid);
      if (manual) {
        // Enrich manual with auto-computed reasons
        const auto = computeDelistRiskScore(sn);
        const enrichedReasons = auto.reasons.length > 0 ? auto.reasons : manual.reasons;
        results.push({
          ...manual,
          score: Math.max(manual.score, auto.score), // Take highest
          reasons: enrichedReasons,
        });
      }
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

/** Get category label */
export function delistCategoryLabel(cat: DelistCategory, fr: boolean): string {
  switch (cat) {
    case "DEPEG_PRIORITY": return fr ? "🔴 DEPEG PRIORITAIRE" : "🔴 DEPEG PRIORITY";
    case "HIGH_RISK_NEAR_DELIST": return fr ? "🟠 PROCHE DELIST" : "🟠 NEAR DELIST";
    case "NORMAL": return "Normal";
  }
}
