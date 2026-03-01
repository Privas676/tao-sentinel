/* ═══════════════════════════════════════ */
/*   DISTRIBUTION MONITOR                   */
/*   Z-score normalization + distribution   */
/*   health checks for PSI & Risk scores    */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";

/* ── Types ── */

export type DistributionReport = {
  metric: string;
  n: number;
  mean: number;
  std: number;
  p10: number;
  p50: number;
  p90: number;
  pctAbove85: number;   // % of values > 85
  pctBelow15: number;   // % of values < 15
  isCompressed: boolean;  // std < 8 → all values clustered
  isExtremeHigh: boolean; // >50% above 85
  isExtremeLow: boolean;  // >50% below 15
  isUnstable: boolean;    // any abnormal condition
};

export type FleetDistributionReport = {
  psi: DistributionReport;
  risk: DistributionReport;
  isFleetUnstable: boolean; // any metric unstable
  killSwitchActive: boolean; // should suspend push notifications
  reasons: string[];
};

/* ── Stats helpers ── */

function computeMean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeStd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ── Distribution analysis ── */

const COMPRESSED_STD_THRESHOLD = 8;
const EXTREME_HIGH_PCT = 0.50; // 50% above 85
const EXTREME_LOW_PCT = 0.50;  // 50% below 15

export function analyzeDistribution(values: number[], metric: string): DistributionReport {
  const n = values.length;
  if (n === 0) {
    return {
      metric, n: 0, mean: 0, std: 0, p10: 0, p50: 0, p90: 0,
      pctAbove85: 0, pctBelow15: 0,
      isCompressed: false, isExtremeHigh: false, isExtremeLow: false, isUnstable: false,
    };
  }

  const mean = computeMean(values);
  const std = computeStd(values, mean);
  const sorted = [...values].sort((a, b) => a - b);
  const p10 = percentile(sorted, 10);
  const p50 = percentile(sorted, 50);
  const p90 = percentile(sorted, 90);
  const above85 = values.filter(v => v > 85).length;
  const below15 = values.filter(v => v < 15).length;
  const pctAbove85 = n > 0 ? above85 / n : 0;
  const pctBelow15 = n > 0 ? below15 / n : 0;

  const isCompressed = std < COMPRESSED_STD_THRESHOLD && n >= 5;
  const isExtremeHigh = pctAbove85 >= EXTREME_HIGH_PCT && n >= 5;
  const isExtremeLow = pctBelow15 >= EXTREME_LOW_PCT && n >= 5;
  const isUnstable = isCompressed || isExtremeHigh || isExtremeLow;

  return {
    metric, n, mean, std: Math.round(std * 100) / 100,
    p10: Math.round(p10 * 10) / 10,
    p50: Math.round(p50 * 10) / 10,
    p90: Math.round(p90 * 10) / 10,
    pctAbove85: Math.round(pctAbove85 * 100),
    pctBelow15: Math.round(pctBelow15 * 100),
    isCompressed, isExtremeHigh, isExtremeLow, isUnstable,
  };
}

/* ── Z-score normalization ── */

/**
 * Apply z-score normalization to a set of values.
 * Converts to z-scores, then maps back to 0..100 using a sigmoid-like transform.
 * If distribution is degenerate (std ≈ 0), falls back to rank-based normalization.
 *
 * @param values Raw values
 * @param clampMin Minimum output value (default 5)
 * @param clampMax Maximum output value (default 95)
 * @returns Normalized values in [clampMin, clampMax]
 */
export function normalizeZScore(
  values: number[],
  clampMin = 5,
  clampMax = 95,
): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];

  const mean = computeMean(values);
  const std = computeStd(values, mean);

  // Degenerate case: all values nearly identical → use rank-based fallback
  if (std < 1) {
    return rankNormalize(values, clampMin, clampMax);
  }

  // Compute z-scores
  const zScores = values.map(v => (v - mean) / std);

  // Map z-scores to 0..100 using sigmoid: z ∈ [-3, 3] → [0, 100]
  // sigmoid(z) = 1 / (1 + e^(-z * steepness))
  const steepness = 1.2; // moderate spread
  const mapped = zScores.map(z => {
    const sig = 1 / (1 + Math.exp(-z * steepness));
    return Math.round(clamp(sig * 100, clampMin, clampMax));
  });

  return mapped;
}

/**
 * Rank-based normalization fallback.
 * Spreads values evenly across the [clampMin, clampMax] range.
 */
function rankNormalize(values: number[], clampMin: number, clampMax: number): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => Math.round((clampMin + clampMax) / 2));

  // Rank values
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const result = new Array<number>(n);
  for (let rank = 0; rank < n; rank++) {
    const t = rank / (n - 1); // 0..1
    result[indexed[rank].i] = Math.round(clampMin + t * (clampMax - clampMin));
  }
  return result;
}

/* ── Fleet-level monitoring ── */

/**
 * Analyze PSI and Risk distributions across the fleet.
 * Returns combined report with kill switch recommendation.
 */
export function monitorFleetDistribution(
  psiValues: number[],
  riskValues: number[],
): FleetDistributionReport {
  const psi = analyzeDistribution(psiValues, "PSI");
  const risk = analyzeDistribution(riskValues, "Risk");
  const reasons: string[] = [];

  if (psi.isCompressed) reasons.push(`PSI compressé (σ=${psi.std})`);
  if (psi.isExtremeHigh) reasons.push(`PSI extrême haut (${psi.pctAbove85}% > 85)`);
  if (psi.isExtremeLow) reasons.push(`PSI extrême bas (${psi.pctBelow15}% < 15)`);
  if (risk.isCompressed) reasons.push(`Risk compressé (σ=${risk.std})`);
  if (risk.isExtremeHigh) reasons.push(`Risk extrême haut (${risk.pctAbove85}% > 85)`);
  if (risk.isExtremeLow) reasons.push(`Risk extrême bas (${risk.pctBelow15}% < 15)`);

  const isFleetUnstable = psi.isUnstable || risk.isUnstable;

  // Kill switch: active when BOTH metrics are unstable, or Risk is extreme high
  const killSwitchActive = (psi.isUnstable && risk.isUnstable) || risk.isExtremeHigh;

  if (isFleetUnstable) {
    console.warn(`[DIST-MONITOR] Fleet unstable: ${reasons.join("; ")}`);
  }
  if (killSwitchActive) {
    console.error(`[DIST-MONITOR] KILL SWITCH ACTIVE — push notifications suspended`);
  }

  return { psi, risk, isFleetUnstable, killSwitchActive, reasons };
}

/* ── Apply z-score normalization to PSI array ── */

/**
 * Normalize PSI values across the fleet using z-score.
 * Preserves relative ordering but ensures spread across 0-100.
 * Original values are blended: 50% original + 50% z-normalized.
 */
export function normalizePsiFleet(rawPsi: number[]): number[] {
  if (rawPsi.length < 3) return rawPsi; // too few to normalize

  const zNorm = normalizeZScore(rawPsi, 10, 90);

  // Blend: 50% original + 50% z-normalized for stability
  return rawPsi.map((raw, i) => {
    const blended = Math.round(raw * 0.5 + zNorm[i] * 0.5);
    return clamp(blended, 0, 100);
  });
}

/**
 * Normalize Risk values across the fleet using z-score.
 * Ensures risk spread: prevents "all red" or "all green".
 */
export function normalizeRiskFleet(rawRisk: number[]): number[] {
  if (rawRisk.length < 3) return rawRisk;

  const zNorm = normalizeZScore(rawRisk, 10, 90);

  // Blend: 50% original + 50% z-normalized
  return rawRisk.map((raw, i) => {
    const blended = Math.round(raw * 0.5 + zNorm[i] * 0.5);
    return clamp(blended, 0, 100);
  });
}
