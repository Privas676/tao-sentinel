/* ═══════════════════════════════════════ */
/*   REGIME ENGINE                           */
/*   Global market regime detection          */
/*   Uses AGGREGATE stats only               */
/*   NO individual subnet overrides          */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";

/* ── Types ── */

export type RegimeState = "OFFENSIVE" | "NEUTRAL" | "DEFENSIVE";

export type RegimeInput = {
  /** Aggregated average opportunity across fleet */
  avgOpportunity: number;
  /** Aggregated average risk across fleet */
  avgRisk: number;
  /** Global smart capital score (0-100) */
  smartCapitalScore: number;
  /** Average stability across fleet */
  avgStability: number;
  /** Average data confidence across fleet */
  avgConfiance: number;
  /** Percentage of fleet in override state (0-100) */
  overridePct: number;
  /** Percentage of fleet with warning status (0-100) */
  warningPct: number;
};

export type RegimeOutput = {
  /** TAO Sentinel Index (0-100) */
  taoIndex: number;
  /** Market regime state */
  regime: RegimeState;
  /** Regime label (localized) */
  regimeLabel: string;
  /** Regime color */
  regimeColor: string;
};

/**
 * Compute the global TAO Sentinel Index.
 * Uses only aggregated fleet statistics — never individual subnet overrides.
 */
export function computeTaoIndex(input: RegimeInput): number {
  const base = input.avgOpportunity * 0.45 - input.avgRisk * 0.35 + input.smartCapitalScore * 0.20;
  let index = clamp(Math.round(base + 20), 0, 100);

  // Fleet health penalty: high override/warning rates depress index
  if (input.overridePct > 30) index -= 10;
  else if (input.overridePct > 15) index -= 5;

  if (input.warningPct > 50) index -= 5;

  // Low stability depresses index
  if (input.avgStability < 35) index -= 8;
  else if (input.avgStability < 50) index -= 3;

  // Low confidence depresses index
  if (input.avgConfiance < 40) index -= 5;

  return clamp(index, 0, 100);
}

/**
 * Derive regime state from TAO index + smart capital.
 */
export function deriveRegime(
  taoIndex: number,
  smartCapitalScore: number,
  avgStability: number,
  avgConfiance: number,
): RegimeState {
  // OFFENSIVE: strong index + accumulation signal + adequate stability
  if (taoIndex >= 65 && smartCapitalScore >= 60 && avgConfiance >= 50) return "OFFENSIVE";
  if (taoIndex >= 55 && avgStability >= 60 && smartCapitalScore >= 60) return "OFFENSIVE";

  // DEFENSIVE: weak index or distribution signal
  if (taoIndex < 35) return "DEFENSIVE";
  if (taoIndex < 45 && avgStability < 45) return "DEFENSIVE";
  if (smartCapitalScore <= 30) return "DEFENSIVE";

  return "NEUTRAL";
}

/**
 * Full regime evaluation pipeline.
 */
export function evaluateRegime(input: RegimeInput): RegimeOutput {
  const taoIndex = computeTaoIndex(input);
  const regime = deriveRegime(taoIndex, input.smartCapitalScore, input.avgStability, input.avgConfiance);

  return {
    taoIndex,
    regime,
    regimeLabel: regimeLabel(regime),
    regimeColor: regimeColor(regime),
  };
}

/* ── Display helpers ── */

export function regimeLabel(regime: RegimeState): string {
  switch (regime) {
    case "OFFENSIVE": return "OFFENSIF";
    case "NEUTRAL": return "NEUTRE";
    case "DEFENSIVE": return "DÉFENSIF";
  }
}

export function regimeColor(regime: RegimeState): string {
  switch (regime) {
    case "OFFENSIVE": return "rgba(76,175,80,0.9)";
    case "NEUTRAL": return "rgba(255,193,7,0.9)";
    case "DEFENSIVE": return "rgba(229,57,53,0.9)";
  }
}

export function taoIndexColor(score: number): string {
  if (score >= 65) return "rgba(76,175,80,0.9)";
  if (score >= 45) return "rgba(255,193,7,0.9)";
  return "rgba(229,57,53,0.9)";
}
