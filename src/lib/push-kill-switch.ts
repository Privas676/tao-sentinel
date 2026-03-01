/* ═══════════════════════════════════════ */
/*   PUSH KILL SWITCH                       */
/*   Evaluates multiple triggers to decide  */
/*   if push notifications should be        */
/*   suspended (SAFE MODE).                 */
/*                                          */
/*   Triggers:                              */
/*   1. DataConfidence < 80                 */
/*   2. DistributionMonitor compression/    */
/*      extremes                            */
/*   3. >30% subnets critical in <10min     */
/*   4. API error rate > threshold          */
/*                                          */
/*   When active:                           */
/*   - All non-critical push suspended      */
/*   - Only DEPEG_CONFIRMED + system        */
/*     incidents allowed through            */
/* ═══════════════════════════════════════ */

import type { DataConfidenceScore } from "./data-confidence";
import type { FleetDistributionReport } from "./distribution-monitor";

/* ── Types ── */

export type KillSwitchTrigger =
  | "DATA_CONFIDENCE_LOW"
  | "DISTRIBUTION_UNSTABLE"
  | "CRITICAL_SURGE"
  | "API_ERRORS_HIGH";

export type KillSwitchResult = {
  /** Whether SAFE MODE is active */
  active: boolean;
  /** Which triggers fired */
  triggers: KillSwitchTrigger[];
  /** Human-readable reasons */
  reasons: string[];
  /** Timestamp of evaluation */
  evaluatedAt: number;
};

export type KillSwitchInput = {
  /** Global DataConfidence score */
  dataConfidence: DataConfidenceScore | null;
  /** Fleet distribution report */
  fleetDistribution: FleetDistributionReport | null;
  /** Number of subnets currently in BREAK/EXIT state */
  criticalCount: number;
  /** Total number of subnets tracked */
  totalSubnets: number;
  /** Timestamp of when critical count was first elevated (ms), or null */
  criticalSurgeStartedAt: number | null;
};

export type KillSwitchConfig = {
  /** DataConfidence threshold below which kill switch activates */
  confidenceThreshold: number;
  /** % of subnets in critical state to trigger surge detection */
  criticalSurgePct: number;
  /** Time window for critical surge (ms) */
  criticalSurgeWindowMs: number;
  /** API error rate component threshold */
  apiErrorThreshold: number;
};

/* ── Default Config ── */

export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = {
  confidenceThreshold: 80,
  criticalSurgePct: 0.30,       // 30% of subnets
  criticalSurgeWindowMs: 10 * 60 * 1000, // 10 minutes
  apiErrorThreshold: 50,        // errorRate component < 50
};

/* ── Evaluator ── */

/**
 * Evaluate all kill switch triggers.
 * Returns whether SAFE MODE should be active.
 */
export function evaluateKillSwitch(
  input: KillSwitchInput,
  config: KillSwitchConfig = DEFAULT_KILL_SWITCH_CONFIG,
): KillSwitchResult {
  const triggers: KillSwitchTrigger[] = [];
  const reasons: string[] = [];

  // 1. DataConfidence < threshold
  if (input.dataConfidence && input.dataConfidence.score < config.confidenceThreshold) {
    triggers.push("DATA_CONFIDENCE_LOW");
    reasons.push(`DataConfidence ${input.dataConfidence.score}% < ${config.confidenceThreshold}%`);
  }

  // 2. Distribution compression/extremes
  if (input.fleetDistribution?.killSwitchActive) {
    triggers.push("DISTRIBUTION_UNSTABLE");
    reasons.push(`Distribution: ${input.fleetDistribution.reasons.join(", ")}`);
  }

  // 3. Critical surge: >30% subnets critical within 10min window
  if (input.totalSubnets > 0) {
    const criticalPct = input.criticalCount / input.totalSubnets;
    if (criticalPct >= config.criticalSurgePct) {
      const inWindow = input.criticalSurgeStartedAt !== null &&
        (Date.now() - input.criticalSurgeStartedAt) < config.criticalSurgeWindowMs;
      if (inWindow || input.criticalSurgeStartedAt === null) {
        triggers.push("CRITICAL_SURGE");
        reasons.push(`${Math.round(criticalPct * 100)}% subnets critiques (${input.criticalCount}/${input.totalSubnets})`);
      }
    }
  }

  // 4. API error rate high (from DataConfidence components)
  if (input.dataConfidence && input.dataConfidence.components.errorRate < config.apiErrorThreshold) {
    triggers.push("API_ERRORS_HIGH");
    reasons.push(`Taux erreur API: ${100 - input.dataConfidence.components.errorRate}%`);
  }

  // SAFE MODE activates with ≥ 1 trigger
  return {
    active: triggers.length > 0,
    triggers,
    reasons,
    evaluatedAt: Date.now(),
  };
}

/* ── Push Filtering ── */

/** Event types that are ALWAYS allowed through kill switch */
const CRITICAL_PASS_THROUGH = new Set([
  "DEPEG_CONFIRMED",
  "DATA_UNSTABLE",    // System incident
]);

/**
 * Filter an event type: returns true if the event should be sent.
 * In SAFE MODE, only critical pass-through events are allowed.
 */
export function shouldSendPush(
  eventType: string,
  killSwitch: KillSwitchResult,
): boolean {
  if (!killSwitch.active) return true;
  return CRITICAL_PASS_THROUGH.has(eventType);
}
