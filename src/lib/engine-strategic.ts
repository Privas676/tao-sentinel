/* ═══════════════════════════════════════ */
/*   STRATEGIC ENGINE                        */
/*   Pure scoring: no protection deps        */
/*   Inputs: raw metrics only                */
/*   Outputs: opp, risk, momentum, SC, etc.  */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";
import { normalizeOpportunity, normalizeWithVariance } from "./gauge-normalize";
import { computeMomentumScoreV2, assignMomentumLabels, computeStabilitySetup } from "./gauge-momentum";
import { computeHealthRisk, computeHealthOpportunity, type HealthScores, type RecalculatedMetrics } from "./subnet-health";
import { calibrateScores } from "./risk-calibration";
import { deriveSubnetAction, type StrategicAction } from "./strategy-subnet";
import type { SmartCapitalState, MomentumLabel } from "./gauge-types";

/* ── Types ── */

export type StrategicInput = {
  netuid: number;
  name: string;
  state: string | null;
  psi: number;
  conf: number;
  quality: number;
  healthScores: HealthScores;
  recalc: RecalculatedMetrics;
  displayedCap: number;
  displayedLiq: number;
  confianceScore: number;
  dataUncertain: boolean;
  priceChange7d: number | null;
  volMcRatio: number | null;
  sparklineLen: number;
};

export type StrategicOutput = {
  netuid: number;
  name: string;
  opp: number;
  risk: number;
  asymmetry: number;
  momentum: number;
  momentumLabel: MomentumLabel;
  momentumScore: number;
  momentumScoreV2: number;
  stability: number;
  sc: SmartCapitalState;
  scScore: number;
  action: StrategicAction;
  oppRaw: number;
  riskRaw: number;
  isCritical: boolean;
};

/* ── Per-subnet Smart Capital (no external deps) ── */

export function deriveSubnetSC(psi: number, quality: number, conf: number, state: string | null): SmartCapitalState {
  const accSignal = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
  const distSignal = clamp((100 - quality) * 0.4, 0, 40) +
    (psi >= 80 && quality < 50 ? 30 : 0) +
    (state === "BREAK" || state === "EXIT_FAST" ? 25 : 0);
  const score = clamp(accSignal - distSignal * 0.5 + 30, 0, 100);
  if (score >= 65) return "ACCUMULATION";
  if (score <= 35) return "DISTRIBUTION";
  return "STABLE";
}

/* ── Batch scoring pipeline ── */

/**
 * Compute strategic scores for all subnets.
 * This is a PURE function: no protection or regime dependencies.
 * Returns raw + blended scores, momentum labels, actions.
 */
export function computeStrategicScores(inputs: StrategicInput[]): StrategicOutput[] {
  if (inputs.length === 0) return [];

  // Step 1: Compute raw scores per subnet
  const rawRows = inputs.map(r => {
    const sc = deriveSubnetSC(r.psi, r.quality, r.conf, r.state);
    const scScore = sc === "ACCUMULATION" ? 70 : sc === "DISTRIBUTION" ? 20 : 45;

    const momentumScoreV2 = computeMomentumScoreV2(r.psi, r.priceChange7d, r.volMcRatio);
    const isCritical = r.state === "BREAK" || r.state === "EXIT_FAST" ||
                       r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL";

    // Pre-hype intensity (strategic signal, not protection)
    const preHypeIntensity = (r.psi > 50 && r.quality > 40 && sc === "ACCUMULATION")
      ? clamp(r.psi - 30, 0, 70) : 0;

    // Health-based raw scores
    const dataConsistencyRisk = 0; // TMC decoupled
    const riskRaw = computeHealthRisk(r.healthScores, dataConsistencyRisk, r.recalc);
    const momentumScore = clamp(r.psi - 40, 0, 60) / 60 * 100; // legacy momentum for health opp
    const oppRaw = computeHealthOpportunity(momentumScore, r.healthScores, scScore, preHypeIntensity, r.recalc);

    return {
      netuid: r.netuid, name: r.name, state: r.state,
      psi: r.psi, conf: r.conf, quality: r.quality,
      oppRaw, riskRaw, momentumScoreV2, isCritical,
      sc, scScore, confianceScore: r.confianceScore,
      dataUncertain: r.dataUncertain,
    };
  });

  // Step 2: Percentile-rank momentum labels
  const momentumLabels = assignMomentumLabels(
    rawRows.map(r => ({ momentumScoreV2: r.momentumScoreV2, isCritical: r.isCritical }))
  );

  // Step 3: Normalize opportunity and risk across fleet
  const oppPercentile = normalizeOpportunity(rawRows.map(r => r.oppRaw));
  const riskPercentile = normalizeWithVariance(rawRows.map(r => r.riskRaw), 3);

  // Step 4: Blend and derive actions
  return rawRows.map((r, i) => {
    let oppBlend = clamp(Math.round(r.oppRaw * 0.6 + oppPercentile[i] * 0.4), 5, 98);
    let riskBlend = clamp(Math.round(r.riskRaw * 0.6 + riskPercentile[i] * 0.4), 0, 100);

    // Critical states → zero opportunity
    const isBreak = r.state === "BREAK" || r.state === "EXIT_FAST";
    if (isBreak || r.state === "DEPEG_WARNING" || r.state === "DEPEG_CRITICAL") {
      oppBlend = 0;
    }

    // Calibrate (floors, compression) — NO override/critical penalty here
    const cal = calibrateScores({
      risk: riskBlend, opportunity: oppBlend,
      state: r.state,
      isTopRank: false,
      isOverridden: false, // Strategic engine doesn't know about overrides
    });

    const opp = cal.opportunity;
    const risk = cal.risk;
    const asymmetry = cal.asymmetry;
    const momentum = clamp(r.psi - 40, 0, 60) / 60 * 100;

    // Derive strategic action (pure: no protection influence)
    const action = deriveSubnetAction(opp, risk, r.conf);

    const stability = computeStabilitySetup(opp, risk, r.conf, momentum, r.quality, r.dataUncertain);

    return {
      netuid: r.netuid,
      name: r.name,
      opp, risk, asymmetry,
      momentum,
      momentumLabel: momentumLabels[i],
      momentumScore: clamp(r.psi - 40, 0, 60) / 60 * 100,
      momentumScoreV2: r.momentumScoreV2,
      stability,
      sc: r.sc,
      scScore: r.scScore,
      action,
      oppRaw: r.oppRaw,
      riskRaw: r.riskRaw,
      isCritical: r.isCritical,
    };
  });
}
