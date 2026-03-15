/* ═══════════════════════════════════════════════════════════ */
/*   CANONICAL DECISION BUILDER                                */
/*   Produces a single CanonicalSubnetDecision per subnet      */
/*   from existing engine outputs.                             */
/*   NO new scoring logic — just mapping and normalization.    */
/*   This is the ONLY place decisions are produced.            */
/* ═══════════════════════════════════════════════════════════ */

import type { SubnetDecision } from "./subnet-decision";
import type { CanonicalSubnetFacts } from "./canonical-types";
import type {
  CanonicalSubnetDecision,
  CanonicalFinalAction,
  CanonicalRawSignal,
  CanonicalPortfolioAction,
} from "./canonical-types";

/* ── Action mapping ── */

function mapFinalAction(decision: SubnetDecision): CanonicalFinalAction {
  switch (decision.finalAction) {
    case "ENTRER": return "ENTRER";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORTIR";
    case "ÉVITER": return "ÉVITER";
    case "SYSTÈME": return "SYSTÈME";
  }
  // If data is too unreliable for any decision
  if (decision.dataUncertain && decision.confidence < 20) {
    return "AUCUNE_DECISION";
  }
  return "SURVEILLER";
}

function mapRawSignal(decision: SubnetDecision): CanonicalRawSignal {
  switch (decision.rawSignal) {
    case "opportunity": return "OPPORTUNITE";
    case "exit": return "RISQUE";
    case "neutral": return "NEUTRE";
  }
  return "NEUTRE";
}

function mapPortfolioAction(decision: SubnetDecision): CanonicalPortfolioAction {
  switch (decision.portfolioAction) {
    case "RENFORCER": return "ADD";
    case "CONSERVER": return "HOLD";
    case "REDUIRE": return "REDUCE";
    case "SORTIR": return "EXIT";
  }
  return "HOLD";
}

/* ── Social bonus computation ── */

/**
 * Compute a bounded social bonus for conviction/momentum.
 * Rules:
 * - Social is an ACCELERATOR, never a primary driver (max +15 pts)
 * - Weighted by credibility: low-credibility signal has minimal impact
 * - Only applies to non-exit actions (SORTIR/ÉVITER are never boosted)
 * - Signal below 20 is noise → no bonus
 */
function computeSocialBonus(
  socialSignal: number,
  socialCredibility: number,
  isExitAction: boolean,
): number {
  if (isExitAction || socialSignal < 20) return 0;
  // Credibility weight: 0-1 (credibility 50+ starts having real impact)
  const credWeight = Math.min(1, Math.max(0, (socialCredibility - 30) / 70));
  // Signal intensity: 0-1 (signal 20-80 range mapped to 0-1)
  const intensity = Math.min(1, Math.max(0, (socialSignal - 20) / 60));
  // Max bonus: 15 points, scaled by both credibility and intensity
  return Math.round(intensity * credWeight * 15);
}

/* ── Main builder ── */

/**
 * Build a CanonicalSubnetDecision from an existing SubnetDecision
 * and optional CanonicalSubnetFacts (for social scores).
 *
 * This is a PURE MAPPING — no new logic, just normalization
 * of existing engine outputs into the canonical format.
 */
export function buildCanonicalDecision(
  decision: SubnetDecision,
  facts?: CanonicalSubnetFacts,
): CanonicalSubnetDecision {
  const now = new Date().toISOString();

  // Extract scores from the verdict v3 if available
  const v3 = decision.verdictV3;
  const scoring = decision.score.derivedScoring?.scores;

  // Social scores from canonical facts (if available)
  const socialSignal = facts?.social_signal_strength ?? 0;
  const socialConfidence = facts?.social_credibility_score ?? 0;

  return {
    subnet_id: decision.netuid,

    // Final Action
    final_action: mapFinalAction(decision),
    final_reason_primary: decision.primaryReason,
    final_reason_secondary: [
      ...decision.thesis.slice(0, 2),
      ...decision.invalidation.slice(0, 1),
    ].filter(Boolean),

    // Raw Signal
    raw_signal: mapRawSignal(decision),
    raw_signal_reason: decision.conflictExplanation
      ? [decision.conflictExplanation]
      : [],

    // Guardrails
    guardrail_active: decision.isBlocked,
    guardrail_reason: decision.blockReasons,

    // Core Scores
    confidence_score: decision.confidence,
    conviction_score: decision.convictionScore,
    momentum_score: decision.momentumScore,

    // Risk Scores
    risk_market_score: decision.score.risk,
    risk_decision_score: Math.round(
      decision.score.risk * 0.6 +
      (decision.delistScore ?? 0) * 0.2 +
      (decision.depegProbability ?? 0) * 0.2
    ),

    // Structural Scores
    structural_fragility_score: scoring?.structuralFragility ?? 50,
    concentration_risk_score: scoring?.concentrationRisk ?? 50,

    // Liquidity / Execution
    liquidity_quality_score: scoring?.liquidityQuality ?? 50,
    execution_quality_score: scoring?.executionQuality ?? 50,

    // External Risk
    depeg_risk_score: scoring?.depegRisk ?? Math.round(decision.depegProbability),
    delist_risk_score: scoring?.delistRisk ?? decision.delistScore,

    // Social
    social_signal_score: socialSignal,
    social_confidence_score: socialConfidence,

    // Data Quality
    source_concordance_score: scoring?.sourceConcordance
      ?? (decision.score.concordance?.score ?? 50),
    data_confidence_score: scoring?.dataConfidence ?? decision.confidence,

    // Portfolio
    portfolio_action: mapPortfolioAction(decision),

    // Metadata
    updated_at: now,
  };
}

/* ── Batch builder ── */

export function buildAllCanonicalDecisions(
  decisions: SubnetDecision[],
  factsMap?: Map<number, CanonicalSubnetFacts>,
): Map<number, CanonicalSubnetDecision> {
  const result = new Map<number, CanonicalSubnetDecision>();
  for (const d of decisions) {
    result.set(d.netuid, buildCanonicalDecision(d, factsMap?.get(d.netuid)));
  }
  return result;
}
