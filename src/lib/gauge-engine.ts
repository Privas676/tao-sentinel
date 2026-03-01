/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — BARREL RE-EXPORT        */
/* ═══════════════════════════════════════ */
/*   Split into focused modules:            */
/*   - gauge-types.ts       (Types + clamp) */
/*   - gauge-normalize.ts   (Percentile/S)  */
/*   - gauge-momentum.ts    (Momentum/Stab) */
/*   - gauge-signals.ts     (Pipeline/Color)*/
/*   - gauge-smart-capital.ts (SC/Global)   */
/* ═══════════════════════════════════════ */

// Types & utilities
export {
  clamp, PSI_THRESHOLDS,
  type GaugeState, type GaugePhase, type Asymmetry, type MomentumLabel,
  type SubnetSignal, type RawSignal, type MarketRiskData,
  type SmartCapitalState, type SmartCapitalData,
  type DualCoreAllocation, type ConsensusDataMap,
} from "./gauge-types";

// Normalization
export {
  normalizeWithVariance,
  normalizeOpportunity,
} from "./gauge-normalize";

// Momentum & Stability
export {
  computeMomentumScore, computeMomentumScoreV2,
  assignMomentumLabels, deriveMomentumLabel,
  momentumColor,
  computeStabilitySetup, stabilityColor,
} from "./gauge-momentum";

// Signal processing & colors
export {
  deriveGaugeState, derivePhase,
  deriveOpportunity, deriveRisk,
  stateColor, stateGlow, rayColor,
  opportunityColor, riskColor,
  classifyMicroCaps, computeASMicro,
  detectPreHype,
  computeSaturationIndex, saturationAlert,
  processSignals,
} from "./gauge-signals";

// Smart Capital & global aggregates
export {
  computeSmartCapital, computeDualCore,
  computeGlobalPsi, computeGlobalConfidence,
  computeGlobalOpportunity, computeGlobalRisk,
} from "./gauge-smart-capital";
