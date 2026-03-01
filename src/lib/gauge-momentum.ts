/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — MOMENTUM & STABILITY    */
/* ═══════════════════════════════════════ */

import { clamp, type MomentumLabel } from "./gauge-types";

/** Compute momentum score (0-100) from PSI + price variation + volume/MC */
export function computeMomentumScore(psi: number, prevPsi?: number): number {
  const base = clamp(psi, 0, 100);
  const delta = prevPsi != null ? psi - prevPsi : 0;
  const accel = clamp(delta * 2, -20, 20);
  return clamp(Math.round(base * 0.7 + 50 * 0.1 + accel + 10), 0, 100);
}

/**
 * Compute momentum score V2 — multi-factor, designed for percentile ranking.
 */
export function computeMomentumScoreV2(
  psi: number,
  priceChange7d: number | null,
  volMcRatio: number | null,
): number {
  const psiNorm = clamp((psi - 30) / 50, 0, 1);
  const psiScore = psiNorm * 40;
  const pc = priceChange7d ?? 0;
  const pcNorm = clamp((pc + 15) / 50, 0, 1);
  const pcScore = pcNorm * 35;
  const vm = volMcRatio ?? 0;
  const vmNorm = clamp(vm / 0.08, 0, 1);
  const vmScore = vmNorm * 25;
  return psiScore + pcScore + vmScore;
}

/**
 * Assign momentum labels using PERCENTILE RANKING across the fleet.
 */
export function assignMomentumLabels(
  rows: { momentumScoreV2: number; isCritical: boolean }[]
): MomentumLabel[] {
  if (rows.length === 0) return [];
  const indexed = rows.map((r, i) => ({ i, score: r.momentumScoreV2 }));
  indexed.sort((a, b) => b.score - a.score);
  const labels: MomentumLabel[] = new Array(rows.length);
  const n = rows.length;

  for (let rank = 0; rank < indexed.length; rank++) {
    const { i } = indexed[rank];
    const pct = rank / n;
    let label: MomentumLabel;
    if (pct < 0.20) label = "FORT";
    else if (pct < 0.60) label = "MODÉRÉ";
    else if (pct < 0.90) label = "STABLE";
    else label = "DÉTÉRIORATION";
    if (rows[i].isCritical && (label === "FORT" || label === "MODÉRÉ")) {
      label = "STABLE";
    }
    labels[i] = label;
  }
  return labels;
}

/** @deprecated Use computeMomentumScoreV2 + assignMomentumLabels instead */
export function deriveMomentumLabel(psi: number, prevPsi?: number): MomentumLabel {
  const score = computeMomentumScore(psi, prevPsi);
  if (score >= 70) return "FORT";
  if (score >= 55) return "MODÉRÉ";
  if (score >= 40) return "STABLE";
  return "DÉTÉRIORATION";
}

export function momentumColor(label: MomentumLabel): string {
  switch (label) {
    case "FORT": return "rgba(76,175,80,0.85)";
    case "MODÉRÉ": return "rgba(255,193,7,0.8)";
    case "STABLE": return "rgba(255,255,255,0.4)";
    case "DÉTÉRIORATION": return "rgba(229,57,53,0.8)";
  }
}

/* ── Stabilité Setup ── */

export function computeStabilitySetup(
  opportunity: number,
  risk: number,
  confidence: number,
  momentum: number,
  quality: number,
  _dataUncertain = false
): number {
  const asymStability = clamp(100 - Math.abs(opportunity - risk) * 0.3, 0, 40);
  const confStability = clamp(confidence * 0.3, 0, 30);
  const momentumStability = momentum >= 35 && momentum <= 75 ? 20 : clamp(20 - Math.abs(momentum - 55) * 0.4, 0, 20);
  const qualityBonus = clamp(quality * 0.1, 0, 10);
  return Math.round(clamp(asymStability + confStability + momentumStability + qualityBonus, 0, 100));
}

export function stabilityColor(pct: number): string {
  if (pct >= 75) return "rgba(76,175,80,0.85)";
  if (pct >= 50) return "rgba(255,193,7,0.8)";
  if (pct >= 30) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}
