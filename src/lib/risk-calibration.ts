/**
 * Risk Calibration Module
 * Enforces floors, compression, and critical-status overrides on risk/opportunity scores.
 */

const CRITICAL_STATES = new Set([
  "DEPEG", "DEPEG_WARNING", "DEPEG_CRITICAL",
  "DEREGISTERING", "DEREGISTRATION",
  "ZONE_CRITIQUE", "BREAK", "EXIT_FAST",
]);

const RISK_FLOOR_ABSOLUTE = 15;
const RISK_FLOOR_TOP_RANK = 25;
const RISK_FLOOR_CRITICAL = 70;
const OPP_CAP_CRITICAL = 30;

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
 * 3. Critical-status override (risk≥70, opp≤30)
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

  // Rule 3: Critical status override
  const isCritical = (state && CRITICAL_STATES.has(state)) || isOverridden;
  if (isCritical) {
    risk = Math.max(risk, RISK_FLOOR_CRITICAL);
    opportunity = Math.min(opportunity, OPP_CAP_CRITICAL);
  }

  // Clamp final values
  risk = clamp(risk, 0, 100);
  opportunity = clamp(opportunity, 0, 100);

  // Rule 4: Recalculate asymmetry
  const asymmetry = opportunity - risk;

  return { risk, opportunity, asymmetry };
}
