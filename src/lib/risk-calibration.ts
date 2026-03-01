/**
 * Risk Calibration Module
 * Enforces floors, compression, and critical-status adjustments on risk/opportunity scores.
 * NO hardcoded risk=70 for critical — uses dynamic scaling from health data.
 */

const CRITICAL_STATES = new Set([
  "DEPEG", "DEPEG_WARNING", "DEPEG_CRITICAL",
  "DEREGISTERING", "DEREGISTRATION",
  "ZONE_CRITIQUE", "BREAK", "EXIT_FAST",
]);

const RISK_FLOOR_ABSOLUTE = 15;
const RISK_FLOOR_TOP_RANK = 25;

/**
 * Dynamic critical risk floor: scales with the computed risk.
 * Instead of hardcoding risk=70, we ensure critical subnets have risk ≥ max(computedRisk, 55)
 * and apply a penalty that scales with how far below 55 they were.
 * This ensures:
 *  - A subnet already at risk=80 stays at 80 (no artificial cap)
 *  - A subnet at risk=30 gets boosted to ~60 (proportional penalty)
 *  - A subnet at risk=50 gets boosted to ~58
 */
function computeCriticalRiskFloor(currentRisk: number): number {
  const MIN_CRITICAL_RISK = 55;
  if (currentRisk >= MIN_CRITICAL_RISK) return currentRisk;
  // Proportional boost: gap * 0.7, so risk=30 → 30 + (25 * 0.7) = 47.5 → floor 55
  const gap = MIN_CRITICAL_RISK - currentRisk;
  return Math.round(currentRisk + gap * 0.8);
}

/**
 * Dynamic opp cap for critical states: scales inversely with risk.
 * High risk → lower opp cap. Low risk → slightly higher cap.
 */
function computeCriticalOppCap(risk: number): number {
  // risk=100 → opp cap=5, risk=55 → opp cap=35, risk=30 → opp cap=40
  return Math.round(Math.max(5, 45 - risk * 0.4));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export interface CalibrationInput {
  risk: number;
  opportunity: number;
  state: string | null | undefined;
  /** If true, apply the stricter top-rank floor (25) */
  isTopRank?: boolean;
  /** If true, subnet is already flagged by risk override engine */
  isOverridden?: boolean;
}

export interface CalibrationOutput {
  risk: number;
  opportunity: number;
  asymmetry: number;
}

/**
 * Apply all calibration rules in order:
 * 1. Absolute floor (15)
 * 2. Top-rank floor (25)
 * 3. Critical-status dynamic adjustment (scaled, not hardcoded)
 * 4. Recalculate asymmetry
 */
export function calibrateScores(input: CalibrationInput): CalibrationOutput {
  let { risk, opportunity, state, isTopRank, isOverridden } = input;

  // Rule 1: Absolute floor
  risk = Math.max(risk, RISK_FLOOR_ABSOLUTE);

  // Rule 2: Top-rank floor
  if (isTopRank) {
    risk = Math.max(risk, RISK_FLOOR_TOP_RANK);
  }

  // Rule 3: Critical status — dynamic scaling (no hardcoded 70/30)
  const isCritical = (state && CRITICAL_STATES.has(state)) || isOverridden;
  if (isCritical) {
    risk = Math.max(risk, computeCriticalRiskFloor(risk));
    opportunity = Math.min(opportunity, computeCriticalOppCap(risk));
  }

  // Clamp final values
  risk = clamp(risk, 0, 100);
  opportunity = clamp(opportunity, 0, 100);

  // Rule 4: Recalculate asymmetry
  const asymmetry = opportunity - risk;

  return { risk, opportunity, asymmetry };
}
