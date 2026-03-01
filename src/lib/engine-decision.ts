/* ═══════════════════════════════════════ */
/*   DECISION LAYER                          */
/*   Merges Strategic + Protection outputs   */
/*   into final unified scores.              */
/*   NO scoring logic — only arbitration.    */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";
import { checkCoherence, type SystemStatus } from "./risk-override";
import type { StrategicAction } from "./strategy-subnet";
import type { StrategicOutput } from "./engine-strategic";
import type { ProtectionOutput } from "./engine-protection";
import type { AlignmentStatus } from "./data-snapshot";
import type { HealthScores, RecalculatedMetrics } from "./subnet-health";
import type { DelistCategory } from "./delist-risk";
import type { SmartCapitalState, MomentumLabel } from "./gauge-types";

/* ── Types ── */

export type AssetType = "SPECULATIVE" | "CORE_NETWORK";

export type SpecialSubnetConfig = {
  label: string;
  forceStatus: SystemStatus;
  forceAction: StrategicAction;
  forceRiskMax: number;
};

export type DecisionInput = {
  strategic: StrategicOutput;
  protection: ProtectionOutput;
  /** Raw input context (pass-through fields) */
  context: {
    state: string | null;
    psi: number;
    conf: number;
    quality: number;
    confianceScore: number;
    dataUncertain: boolean;
    healthScores: HealthScores;
    recalc: RecalculatedMetrics;
    displayedCap: number;
    displayedLiq: number;
    consensusPrice: number;
    alphaPrice: number;
    priceVar30d: number | null;
  };
  /** Special subnet config (if whitelisted) */
  special?: SpecialSubnetConfig;
  /** Current data alignment status */
  alignmentStatus: AlignmentStatus;
};

export type DecisionOutput = {
  netuid: number;
  name: string;
  assetType: AssetType;
  state: string | null;
  psi: number;
  conf: number;
  quality: number;
  opp: number;
  risk: number;
  asymmetry: number;
  momentum: number;
  momentumLabel: MomentumLabel;
  momentumScore: number;
  action: StrategicAction;
  sc: SmartCapitalState;
  confianceScore: number;
  dataUncertain: boolean;
  isOverridden: boolean;
  isWarning: boolean;
  systemStatus: SystemStatus;
  overrideReasons: string[];
  healthScores: HealthScores;
  recalc: RecalculatedMetrics;
  displayedCap: number;
  displayedLiq: number;
  stability: number;
  consensusPrice: number;
  alphaPrice: number;
  priceVar30d: number | null;
  delistCategory: DelistCategory;
  delistScore: number;
};

/* ── Single-subnet decision ── */

/**
 * Merge strategic scores + protection signals into a final unified score.
 * This is PURE arbitration — no new scoring logic.
 *
 * Rules applied (in order):
 * 1. Whitelist overrides (force risk cap, opp range, action)
 * 2. Protection overrides (override → opp=0, action=EXIT)
 * 3. Delist/depeg coherence (DEPEG_PRIORITY → EXIT, HIGH_RISK → cap opp)
 * 4. System status downgrade (non-OK status blocks ENTER)
 * 5. Stale data guard (STALE alignment blocks ENTER)
 * 6. Coherence check (log inconsistencies)
 */
export function applyDecision(input: DecisionInput): DecisionOutput {
  const { strategic: strat, protection: prot, context: ctx, special, alignmentStatus } = input;
  const isWhitelisted = !!special;
  const assetType: AssetType = isWhitelisted ? "CORE_NETWORK" : "SPECULATIVE";

  let opp = strat.opp;
  let risk = strat.risk;
  let asymmetry = strat.asymmetry;
  let action = strat.action;

  // 1. Whitelist overrides
  if (isWhitelisted && special) {
    risk = Math.min(risk, special.forceRiskMax);
    opp = clamp(opp, 30, 60);
    asymmetry = opp - risk;
    action = special.forceAction;
  }

  // 2. Protection overrides: applied AFTER strategic scoring
  if (prot.isOverridden && !isWhitelisted) {
    opp = 0;
    asymmetry = -Math.abs(risk);
    action = "EXIT";
  }

  // 3. DEPEG/DELIST coherence
  if (!isWhitelisted) {
    if (prot.delistCategory === "DEPEG_PRIORITY") {
      opp = 0;
      risk = Math.max(risk, 80);
      asymmetry = -Math.abs(asymmetry) - 20;
      action = "EXIT";
    } else if (prot.delistCategory === "HIGH_RISK_NEAR_DELIST") {
      opp = Math.min(opp, 25);
      risk = Math.max(risk, 60);
      asymmetry = Math.min(asymmetry, -5);
      if (action === "ENTER") action = "WATCH";
    }

    // 4. System status downgrade
    if (prot.systemStatus !== "OK" && action === "ENTER") action = "WATCH";
  }

  // 5. STALE DATA GUARD
  if (alignmentStatus === "STALE" && action === "ENTER") {
    action = "WATCH";
  }

  // 6. Coherence check
  if (!isWhitelisted) {
    checkCoherence(prot.isOverridden, action);
  }

  return {
    netuid: strat.netuid,
    name: strat.name,
    assetType,
    state: ctx.state,
    psi: ctx.psi,
    conf: ctx.conf,
    quality: ctx.quality,
    opp, risk, asymmetry,
    momentum: strat.momentum,
    momentumLabel: strat.momentumLabel,
    momentumScore: strat.momentumScore,
    action,
    sc: strat.sc,
    confianceScore: ctx.confianceScore,
    dataUncertain: ctx.dataUncertain,
    isOverridden: prot.isOverridden,
    isWarning: prot.isWarning,
    systemStatus: prot.systemStatus,
    overrideReasons: prot.overrideReasons,
    healthScores: ctx.healthScores,
    recalc: ctx.recalc,
    displayedCap: ctx.displayedCap,
    displayedLiq: ctx.displayedLiq,
    stability: strat.stability,
    consensusPrice: ctx.consensusPrice,
    alphaPrice: ctx.alphaPrice,
    priceVar30d: ctx.priceVar30d,
    delistCategory: prot.delistCategory,
    delistScore: prot.delistScore,
  };
}

/* ── Batch decision ── */

/**
 * Apply decision layer to all subnets, then sort by asymmetry desc.
 */
export function applyAllDecisions(inputs: DecisionInput[]): DecisionOutput[] {
  const results = inputs.map(applyDecision);
  results.sort((a, b) => b.asymmetry - a.asymmetry);
  return results;
}
