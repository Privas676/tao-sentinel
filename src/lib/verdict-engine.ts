/* ═══════════════════════════════════════ */
/*   VERDICT ENGINE v2                       */
/*   RENTRE / HOLD / SORS                    */
/*   Based on 3 sub-scores:                  */
/*   - ENTRY_SCORE (rotation quality)        */
/*   - HOLD_SCORE  (conservation quality)    */
/*   - EXIT_RISK   (danger probability)      */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-types";
import type { StakeSnapshot, StakeDeltas, PriceContext, EconomicContext, DerivedMetrics, RadarScores } from "./stake-analytics";

/* ── Types ── */

export type Verdict = "RENTRE" | "HOLD" | "SORS";
export type ConfidenceLevel = "forte" | "moyenne" | "faible";

export type VerdictReason = {
  label: string;
  positive: boolean;
};

export type VerdictResult = {
  netuid: number;
  verdict: Verdict;
  confidence: ConfidenceLevel;
  entryScore: number;    // 0-100
  holdScore: number;     // 0-100
  exitRisk: number;      // 0-100
  positiveReasons: string[];  // max 3
  negativeReasons: string[];  // max 3
  /** Full scored reason list for detailed views */
  allReasons: VerdictReason[];
};

/* ── Input from combined data sources ── */

export type VerdictInput = {
  netuid: number;
  // From stake-analytics
  snapshot: StakeSnapshot;
  deltas: StakeDeltas;
  priceContext: PriceContext;
  economicContext: EconomicContext;
  derivedMetrics: DerivedMetrics;
  radarScores: RadarScores;
  // From unified scores (optional enrichment)
  momentum?: number;         // 0-100
  stability?: number;        // 0-100
  dataConfidence?: number;   // 0-100
  isWhitelisted?: boolean;
};

/* ═══════════════════════════════════════ */
/*  COMPONENT SCORES                        */
/* ═══════════════════════════════════════ */

/* ── A. Capital Rotation Score (0-100) ── */
function computeCapitalRotationScore(
  d: StakeDeltas, s: StakeSnapshot, p: PriceContext, eco: EconomicContext, dm: DerivedMetrics,
): number {
  let score = 0;

  // Stake flow 7d (strongest signal)
  if (d.stakeChange7d > 0.15) score += 30;
  else if (d.stakeChange7d > 0.05) score += 22;
  else if (d.stakeChange7d > 0.01) score += 12;
  else if (d.stakeChange7d > -0.02) score += 5;
  else if (d.stakeChange7d > -0.10) score += 0;
  else score -= 5;

  // Buy/sell ratio (sentiment)
  if (eco.sentiment > 0.65) score += 25;
  else if (eco.sentiment > 0.55) score += 18;
  else if (eco.sentiment > 0.48) score += 10;
  else if (eco.sentiment > 0.40) score += 3;
  else score += 0;

  // Net whale flow
  const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
  if (netFlow > 50) score += 20;
  else if (netFlow > 10) score += 14;
  else if (netFlow > 0) score += 7;
  else if (netFlow > -20) score += 2;
  else score += 0;

  // Momentum (price trend alignment)
  if (p.priceChange7d > 15) score += 15;
  else if (p.priceChange7d > 5) score += 12;
  else if (p.priceChange7d > 0) score += 7;
  else if (p.priceChange7d > -5) score += 3;
  else score += 0;

  // Emission share growth proxy
  if (p.emissionShare > 3) score += 10;
  else if (p.emissionShare > 1) score += 7;
  else if (p.emissionShare > 0.3) score += 3;
  else score += 0;

  return clamp(Math.round(score), 0, 100);
}

/* ── B. Emissions Score (0-100) ── */
function computeEmissionsScore(eco: EconomicContext, p: PriceContext): number {
  let score = 0;

  // Emissions % of network
  if (eco.emissionsPercent > 4) score += 35;
  else if (eco.emissionsPercent > 2) score += 28;
  else if (eco.emissionsPercent > 1) score += 20;
  else if (eco.emissionsPercent > 0.3) score += 12;
  else score += 4;

  // Emissions per day (absolute strength)
  if (eco.emissionsPerDay > 500) score += 25;
  else if (eco.emissionsPerDay > 100) score += 20;
  else if (eco.emissionsPerDay > 30) score += 14;
  else if (eco.emissionsPerDay > 5) score += 8;
  else score += 2;

  // Emission efficiency (emissions/mcap)
  const eff = p.marketCap > 0 ? eco.emissionsPerDay / p.marketCap : 0;
  if (eff > 0.005) score += 20;
  else if (eff > 0.001) score += 15;
  else if (eff > 0.0005) score += 10;
  else if (eff > 0.0001) score += 5;
  else score += 0;

  // Reward distribution health
  const hasDistribution = eco.minerPerDay > 0 && eco.validatorPerDay > 0;
  if (hasDistribution) score += 10;
  else score += 2;

  // Volume/MCap ratio (liquidity supports emissions)
  if (eco.volumeMarketcapRatio > 0.05) score += 10;
  else if (eco.volumeMarketcapRatio > 0.01) score += 7;
  else if (eco.volumeMarketcapRatio > 0.003) score += 4;
  else score += 0;

  return clamp(Math.round(score), 0, 100);
}

/* ── C. Market Structure Score (0-100) ── */
function computeMarketStructureScore(p: PriceContext, eco: EconomicContext, dm: DerivedMetrics): number {
  let score = 0;

  // Volume/MCap (tradability)
  const volMcap = eco.volumeMarketcapRatio;
  if (volMcap > 0.08) score += 30;
  else if (volMcap > 0.03) score += 24;
  else if (volMcap > 0.01) score += 18;
  else if (volMcap > 0.003) score += 10;
  else score += 2;

  // Pool balance (AMM health)
  if (dm.poolBalance > 0.7 && dm.poolBalance < 1.5) score += 25;
  else if (dm.poolBalance > 0.4 && dm.poolBalance < 2.5) score += 18;
  else if (dm.poolBalance > 0.2) score += 10;
  else score += 2;

  // Liquidity depth
  if (p.liquidity > 1000) score += 20;
  else if (p.liquidity > 200) score += 15;
  else if (p.liquidity > 50) score += 10;
  else if (p.liquidity > 10) score += 5;
  else score += 0;

  // Market cap (size = stability)
  if (p.marketCap > 5000) score += 15;
  else if (p.marketCap > 1000) score += 12;
  else if (p.marketCap > 200) score += 8;
  else if (p.marketCap > 50) score += 4;
  else score += 0;

  // Price stability (not crashing)
  if (p.priceChange1d > -3) score += 10;
  else if (p.priceChange1d > -8) score += 5;
  else score += 0;

  return clamp(Math.round(score), 0, 100);
}

/* ── D. Adoption Quality Score (0-100) ── */
function computeAdoptionQualityScore(s: StakeSnapshot, d: StakeDeltas, dm: DerivedMetrics): number {
  let score = 0;

  // Validator count
  if (s.validatorsActive >= 20) score += 25;
  else if (s.validatorsActive >= 10) score += 20;
  else if (s.validatorsActive >= 5) score += 12;
  else if (s.validatorsActive >= 2) score += 5;
  else score += 0;

  // Miners count (real network usage)
  if (s.minersActive >= 100) score += 25;
  else if (s.minersActive >= 50) score += 20;
  else if (s.minersActive >= 20) score += 14;
  else if (s.minersActive >= 5) score += 7;
  else score += 0;

  // UID saturation (utilization)
  const sat = dm.uidSaturation;
  if (sat > 0.8 && d.minersGrowth7d > 0) score += 15; // full + growing = strong
  else if (sat > 0.6) score += 12;
  else if (sat > 0.3) score += 8;
  else score += 2;

  // Miners growth (dynamic)
  if (d.minersGrowth7d > 0.10) score += 15;
  else if (d.minersGrowth7d > 0.02) score += 10;
  else if (d.minersGrowth7d > -0.02) score += 5;
  else score += 0;

  // Validators growth
  if (d.validatorsGrowth7d > 0.05) score += 10;
  else if (d.validatorsGrowth7d > 0) score += 7;
  else if (d.validatorsGrowth7d >= -0.05) score += 3;
  else score += 0;

  // Concentration penalty — Bittensor-calibrated (90%+ is normal)
  if (s.stakeConcentration > 98) score -= 8;
  else if (s.stakeConcentration > 95) score -= 4;

  return clamp(Math.round(score), 0, 100);
}

/* ── E. Narrative Confirmation Score (0-100) ── */
function computeNarrativeConfirmation(radarScores: RadarScores): number {
  // Weak signal: based on existing narrative + smart money scores
  const raw = radarScores.narrativeScore * 0.5 + radarScores.smartMoneyScore * 0.5;
  return clamp(Math.round(raw), 0, 100);
}

/* ═══════════════════════════════════════ */
/*  ENTRY_SCORE                              */
/* ═══════════════════════════════════════ */

export function computeEntryScore(input: VerdictInput): number {
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm, radarScores } = input;

  const capitalRotation = computeCapitalRotationScore(d, s, p, eco, dm);
  const emissions = computeEmissionsScore(eco, p);
  const marketStructure = computeMarketStructureScore(p, eco, dm);
  const adoption = computeAdoptionQualityScore(s, d, dm);
  const narrative = computeNarrativeConfirmation(radarScores);

  return clamp(Math.round(
    0.35 * capitalRotation +
    0.25 * emissions +
    0.20 * marketStructure +
    0.15 * adoption +
    0.05 * narrative
  ), 0, 100);
}

/* ═══════════════════════════════════════ */
/*  HOLD_SCORE                               */
/* ═══════════════════════════════════════ */

/* ── Momentum persistence (0-100) ── */
function computeMomentumPersistence(p: PriceContext, d: StakeDeltas, extMomentum?: number): number {
  let score = 0;
  // External momentum if available
  if (extMomentum != null) {
    score += clamp(extMomentum * 0.4, 0, 40);
  } else {
    // Price momentum proxy
    if (p.priceChange7d > 10) score += 30;
    else if (p.priceChange7d > 3) score += 22;
    else if (p.priceChange7d > -2) score += 12;
    else score += 0;
  }
  // Stake persistence
  if (d.stakeChange7d > 0.05) score += 25;
  else if (d.stakeChange7d > 0) score += 18;
  else if (d.stakeChange7d > -0.05) score += 8;
  else score += 0;
  // 1d trend (short-term confirm)
  if (p.priceChange1d > 2) score += 15;
  else if (p.priceChange1d > -1) score += 10;
  else if (p.priceChange1d > -5) score += 4;
  else score += 0;
  // Volume consistency
  const volMcap = p.marketCap > 0 ? p.vol24h / p.marketCap : 0;
  if (volMcap > 0.02) score += 10;
  else if (volMcap > 0.005) score += 6;
  else score += 2;
  return clamp(Math.round(score), 0, 100);
}

/* ── Emissions stability (0-100) ── */
function computeEmissionsStability(eco: EconomicContext): number {
  let score = 50; // neutral baseline
  if (eco.emissionsPerDay > 100) score += 20;
  else if (eco.emissionsPerDay > 20) score += 12;
  else score += 0;
  if (eco.emissionsPercent > 1) score += 15;
  else if (eco.emissionsPercent > 0.3) score += 8;
  else score -= 5;
  // Reward distribution exists
  if (eco.minerPerDay > 0 && eco.validatorPerDay > 0) score += 10;
  // Sentiment stable
  if (eco.sentiment > 0.45 && eco.sentiment < 0.65) score += 5; // balanced
  return clamp(Math.round(score), 0, 100);
}

/* ── Structure stability (0-100) ── */
function computeStructureStability(s: StakeSnapshot, d: StakeDeltas, extStability?: number): number {
  let score = 0;
  if (extStability != null) {
    score += clamp(extStability * 0.5, 0, 50);
  } else {
    score += 25; // neutral
  }
  // Concentration: lower = more stable (Bittensor-calibrated)
  if (s.stakeConcentration < 80) score += 20;
  else if (s.stakeConcentration < 92) score += 14;
  else if (s.stakeConcentration < 98) score += 8;
  else score += 3;
  // Miners stable or growing
  if (d.minersGrowth7d > 0) score += 15;
  else if (d.minersGrowth7d > -0.05) score += 10;
  else score += 0;
  // UID usage healthy
  if (s.uidUsage > 0.5) score += 10;
  else if (s.uidUsage > 0.2) score += 6;
  else score += 2;
  return clamp(Math.round(score), 0, 100);
}

/* ── Validator quality (0-100) ── */
function computeValidatorQuality(s: StakeSnapshot): number {
  let score = 0;
  if (s.validatorsActive >= 20) score += 40;
  else if (s.validatorsActive >= 10) score += 30;
  else if (s.validatorsActive >= 5) score += 18;
  else if (s.validatorsActive >= 2) score += 8;
  else score += 0;
  // Validator/miner ratio (healthy = miners > validators)
  const ratio = s.validatorsActive > 0 ? s.minersActive / s.validatorsActive : 0;
  if (ratio > 5) score += 25;
  else if (ratio > 2) score += 18;
  else if (ratio > 1) score += 10;
  else score += 3;
  // Concentration inverse (Bittensor-calibrated)
  if (s.stakeConcentration < 85) score += 20;
  else if (s.stakeConcentration < 95) score += 14;
  else score += 5;
  // Miners count (real usage)
  if (s.minersActive >= 50) score += 15;
  else if (s.minersActive >= 20) score += 10;
  else if (s.minersActive >= 5) score += 5;
  else score += 0;
  return clamp(Math.round(score), 0, 100);
}

/* ── Liquidity survival (0-100) ── */
function computeLiquiditySurvival(p: PriceContext, dm: DerivedMetrics): number {
  let score = 0;
  // Pool balance (closer to 1 = healthier)
  if (dm.poolBalance > 0.6 && dm.poolBalance < 1.8) score += 35;
  else if (dm.poolBalance > 0.3 && dm.poolBalance < 3) score += 22;
  else score += 8;
  // Absolute liquidity
  if (p.liquidity > 500) score += 25;
  else if (p.liquidity > 100) score += 18;
  else if (p.liquidity > 20) score += 10;
  else score += 2;
  // Volume (some activity)
  if (p.vol24h > 50) score += 20;
  else if (p.vol24h > 10) score += 14;
  else if (p.vol24h > 1) score += 7;
  else score += 0;
  // MCap stability
  if (p.marketCap > 500) score += 15;
  else if (p.marketCap > 100) score += 10;
  else score += 3;
  return clamp(Math.round(score), 0, 100);
}

export function computeHoldScore(input: VerdictInput): number {
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm } = input;

  const momentumPersistence = computeMomentumPersistence(p, d, input.momentum);
  const emissionsStability = computeEmissionsStability(eco);
  const structureStability = computeStructureStability(s, d, input.stability);
  const validatorQuality = computeValidatorQuality(s);
  const liquiditySurvival = computeLiquiditySurvival(p, dm);

  return clamp(Math.round(
    0.30 * momentumPersistence +
    0.25 * emissionsStability +
    0.20 * structureStability +
    0.15 * validatorQuality +
    0.10 * liquiditySurvival
  ), 0, 100);
}

/* ═══════════════════════════════════════ */
/*  EXIT_RISK                                */
/* ═══════════════════════════════════════ */

/* ── Sell pressure score (0-100) ── */
function computeSellPressureScore(eco: EconomicContext, p: PriceContext): number {
  let score = 0;
  // Sell dominance
  const totalVol = eco.buyVolume + eco.sellVolume;
  if (totalVol > 0) {
    const sellRatio = eco.sellVolume / totalVol;
    if (sellRatio > 0.75) score += 40;
    else if (sellRatio > 0.60) score += 28;
    else if (sellRatio > 0.52) score += 15;
    else score += 5;
  } else {
    // Price-based fallback
    if (p.priceChange1d < -10) score += 35;
    else if (p.priceChange1d < -5) score += 22;
    else if (p.priceChange1d < -2) score += 10;
    else score += 5;
  }
  // Sellers > buyers
  if (eco.sellersCount > eco.buyersCount * 2) score += 25;
  else if (eco.sellersCount > eco.buyersCount * 1.3) score += 15;
  else if (eco.sellersCount > eco.buyersCount) score += 8;
  else score += 0;
  // Price crash 7d
  if (p.priceChange7d < -25) score += 25;
  else if (p.priceChange7d < -10) score += 15;
  else if (p.priceChange7d < -3) score += 8;
  else score += 0;
  // Volume spike without price increase (distribution)
  const volMcap = p.marketCap > 0 ? p.vol24h / p.marketCap : 0;
  if (volMcap > 0.1 && p.priceChange1d < 0) score += 10;
  return clamp(Math.round(score), 0, 100);
}

/* ── Concentration risk (0-100) ── */
/* Bittensor subnets typically have 90-100% top-10 concentration; calibrated accordingly */
function computeConcentrationRisk(s: StakeSnapshot): number {
  let score = 0;
  // Stake concentration — Bittensor-calibrated brackets
  if (s.stakeConcentration > 98) score += 25;
  else if (s.stakeConcentration > 95) score += 18;
  else if (s.stakeConcentration > 85) score += 12;
  else if (s.stakeConcentration > 70) score += 6;
  else score += 0;
  // Validator centralization
  if (s.validatorsActive <= 1) score += 30;
  else if (s.validatorsActive <= 3) score += 22;
  else if (s.validatorsActive <= 5) score += 12;
  else if (s.validatorsActive <= 10) score += 5;
  else score += 0;
  // Few miners = fragile
  if (s.minersActive <= 2) score += 25;
  else if (s.minersActive <= 10) score += 15;
  else if (s.minersActive <= 30) score += 8;
  else score += 0;
  return clamp(Math.round(score), 0, 100);
}

/* ── Liquidity risk (0-100) ── */
function computeLiquidityRisk(p: PriceContext, dm: DerivedMetrics, eco: EconomicContext): number {
  let score = 0;
  // Very low liquidity
  if (p.liquidity < 5) score += 40;
  else if (p.liquidity < 20) score += 28;
  else if (p.liquidity < 100) score += 15;
  else if (p.liquidity < 500) score += 6;
  else score += 0;
  // Pool imbalance
  if (dm.poolBalance < 0.2 || dm.poolBalance > 5) score += 25;
  else if (dm.poolBalance < 0.4 || dm.poolBalance > 3) score += 15;
  else if (dm.poolBalance < 0.6 || dm.poolBalance > 2) score += 6;
  else score += 0;
  // Volume/MCap (no liquidity = can't exit)
  const volMcap = eco.volumeMarketcapRatio;
  if (volMcap < 0.001) score += 25;
  else if (volMcap < 0.005) score += 15;
  else if (volMcap < 0.01) score += 6;
  else score += 0;
  // Very small mcap
  if (p.marketCap < 10) score += 10;
  else if (p.marketCap < 50) score += 5;
  return clamp(Math.round(score), 0, 100);
}

/* ── Flow reversal (0-100) ── */
function computeFlowReversal(d: StakeDeltas, s: StakeSnapshot): number {
  let score = 0;
  // Stake outflow
  if (d.stakeChange7d < -0.20) score += 40;
  else if (d.stakeChange7d < -0.10) score += 28;
  else if (d.stakeChange7d < -0.03) score += 15;
  else if (d.stakeChange7d < 0) score += 5;
  else score += 0;
  // Miners declining
  if (d.minersGrowth7d < -0.15) score += 25;
  else if (d.minersGrowth7d < -0.05) score += 15;
  else if (d.minersGrowth7d < 0) score += 5;
  else score += 0;
  // Whale outflow
  const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
  if (netFlow < -50) score += 25;
  else if (netFlow < -10) score += 15;
  else if (netFlow < 0) score += 5;
  else score += 0;
  // Validators declining
  if (d.validatorsGrowth7d < -0.10) score += 10;
  else if (d.validatorsGrowth7d < 0) score += 3;
  return clamp(Math.round(score), 0, 100);
}

/* ── Saturation risk (0-100) ── */
function computeSaturationRisk(s: StakeSnapshot, d: StakeDeltas, dm: DerivedMetrics): number {
  let score = 0;
  const sat = dm.uidSaturation;
  // Saturated with no growth = stagnation
  if (sat > 0.95 && d.minersGrowth7d <= 0) score += 40;
  else if (sat > 0.90 && d.minersGrowth7d <= 0) score += 28;
  else if (sat > 0.95 && d.minersGrowth7d > 0) score += 15; // saturated but growing
  else if (sat > 0.80) score += 8;
  else score += 0;
  // No room to grow
  if (s.uidMax > 0 && s.uidUsed >= s.uidMax && d.minersGrowth7d < 0) score += 30;
  else if (s.uidMax > 0 && s.uidMax - s.uidUsed < 10) score += 15;
  else score += 0;
  // High concentration + saturation (Bittensor-calibrated)
  if (s.stakeConcentration > 98 && sat > 0.8) score += 20;
  else if (s.stakeConcentration > 40 && sat > 0.9) score += 10;
  // Low miners despite saturation
  if (sat > 0.8 && s.minersActive < 10) score += 10;
  return clamp(Math.round(score), 0, 100);
}

export function computeExitRisk(input: VerdictInput): number {
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm } = input;

  const sellPressure = computeSellPressureScore(eco, p);
  const concentration = computeConcentrationRisk(s);
  const liquidity = computeLiquidityRisk(p, dm, eco);
  const flowReversal = computeFlowReversal(d, s);
  const saturation = computeSaturationRisk(s, d, dm);

  return clamp(Math.round(
    0.30 * sellPressure +
    0.25 * concentration +
    0.20 * liquidity +
    0.15 * flowReversal +
    0.10 * saturation
  ), 0, 100);
}

/* ═══════════════════════════════════════ */
/*  CONFIDENCE                               */
/* ═══════════════════════════════════════ */

function computeConfidence(input: VerdictInput, entryScore: number, holdScore: number, exitRisk: number): ConfidenceLevel {
  // Count aligned signal families (5 families)
  let aligned = 0;
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm } = input;

  // A. Capital rotation signal (clear direction)
  const capitalClear = d.stakeChange7d > 0.03 || d.stakeChange7d < -0.05;
  if (capitalClear) aligned++;

  // B. Emissions signal (meaningful emissions)
  if (eco.emissionsPerDay > 10 && eco.emissionsPercent > 0.2) aligned++;

  // C. Market structure signal (tradable)
  if (eco.volumeMarketcapRatio > 0.005 && p.liquidity > 20) aligned++;

  // D. Adoption signal (real usage)
  if (s.minersActive >= 5 && s.validatorsActive >= 3) aligned++;

  // E. Risk signal (clear risk or safety)
  if (exitRisk > 55 || exitRisk < 30) aligned++;

  // Data confidence penalty
  if (input.dataConfidence != null && input.dataConfidence < 40) {
    return "faible";
  }

  if (aligned >= 4) return "forte";
  if (aligned >= 2) return "moyenne";
  return "faible";
}

/* ═══════════════════════════════════════ */
/*  REASONS (human-readable)                 */
/* ═══════════════════════════════════════ */

function collectReasons(input: VerdictInput, entryScore: number, holdScore: number, exitRisk: number): VerdictReason[] {
  const reasons: VerdictReason[] = [];
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm } = input;

  // Capital flow
  if (d.stakeChange7d > 0.05) reasons.push({ label: "Flux de stake en hausse 7j", positive: true });
  else if (d.stakeChange7d < -0.05) reasons.push({ label: "Flux de stake en baisse 7j", positive: false });

  // Sentiment
  if (eco.sentiment > 0.6) reasons.push({ label: "Pression acheteuse dominante", positive: true });
  else if (eco.sentiment < 0.4) reasons.push({ label: "Pression vendeuse élevée", positive: false });

  // Emissions
  if (eco.emissionsPerDay > 100 && eco.emissionsPercent > 1) reasons.push({ label: "Émissions solides", positive: true });
  else if (eco.emissionsPerDay < 5) reasons.push({ label: "Émissions très faibles", positive: false });

  // Validators
  if (s.validatorsActive >= 15) reasons.push({ label: "Structure validators saine", positive: true });
  else if (s.validatorsActive <= 2) reasons.push({ label: "Très peu de validators", positive: false });

  // Miners
  if (s.minersActive >= 50 && d.minersGrowth7d > 0) reasons.push({ label: "Adoption mineurs en croissance", positive: true });
  else if (s.minersActive < 5) reasons.push({ label: "Très peu de mineurs actifs", positive: false });
  else if (d.minersGrowth7d < -0.10) reasons.push({ label: "Baisse des mineurs", positive: false });

  // Concentration
  if (s.stakeConcentration > 98) reasons.push({ label: "Concentration stake extrême", positive: false });
  else if (s.stakeConcentration < 85) reasons.push({ label: "Stake relativement distribué", positive: true });

  // Liquidity
  if (p.liquidity > 500) reasons.push({ label: "Liquidité correcte", positive: true });
  else if (p.liquidity < 20) reasons.push({ label: "Sous-liquidité critique", positive: false });

  // UID saturation
  if (dm.uidSaturation > 0.95 && d.minersGrowth7d <= 0) reasons.push({ label: "Saturé sans croissance", positive: false });

  // Pool balance
  if (dm.poolBalance < 0.3) reasons.push({ label: "Déséquilibre pool critique", positive: false });

  // Price momentum
  if (p.priceChange7d > 10) reasons.push({ label: "Momentum prix positif", positive: true });
  else if (p.priceChange7d < -15) reasons.push({ label: "Chute de prix 7j", positive: false });

  // Whale flow
  const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
  if (netFlow > 30) reasons.push({ label: "Afflux whale significatif", positive: true });
  else if (netFlow < -30) reasons.push({ label: "Sortie whale significative", positive: false });

  // Volume
  if (eco.volumeMarketcapRatio > 0.05) reasons.push({ label: "Volume/MCap élevé", positive: true });
  else if (eco.volumeMarketcapRatio < 0.001) reasons.push({ label: "Volume quasi nul", positive: false });

  return reasons;
}

/* ═══════════════════════════════════════ */
/*  MAIN VERDICT                             */
/* ═══════════════════════════════════════ */

export function computeVerdict(input: VerdictInput): VerdictResult {
  // Whitelisted subnets (e.g. ROOT) → forced HOLD
  if (input.isWhitelisted) {
    return {
      netuid: input.netuid,
      verdict: "HOLD",
      confidence: "forte",
      entryScore: 50,
      holdScore: 80,
      exitRisk: 10,
      positiveReasons: ["Subnet système (réseau principal)"],
      negativeReasons: [],
      allReasons: [{ label: "Subnet système (réseau principal)", positive: true }],
    };
  }

  const entryScore = computeEntryScore(input);
  const holdScore = computeHoldScore(input);
  const exitRisk = computeExitRisk(input);
  const confidence = computeConfidence(input, entryScore, holdScore, exitRisk);
  const allReasons = collectReasons(input, entryScore, holdScore, exitRisk);

  // ── Decision logic ──
  let verdict: Verdict;

  if (exitRisk >= 55) {
    verdict = "SORS";
  } else if (entryScore >= 55 && exitRisk < 42) {
    verdict = "RENTRE";
  } else if (holdScore >= 50 && exitRisk < 55) {
    verdict = "HOLD";
  } else {
    // Conflict → prudent HOLD
    verdict = "HOLD";
  }

  // ── Safety guards ──

  // G1: Very few validators → block RENTRE
  if (input.snapshot.validatorsActive <= 2 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // G2: UID saturated + no growth → upgrade risk
  if (input.derivedMetrics.uidSaturation > 0.95 && input.deltas.minersGrowth7d <= 0 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // G3: High sell pressure + low liquidity → force SORS
  if (input.economicContext.sentiment < 0.35 && input.priceContext.liquidity < 30 && verdict !== "SORS") {
    verdict = "SORS";
  }

  // G4: Strong capital flow but validator risk → cap at HOLD
  if (entryScore > 60 && input.snapshot.validatorsActive <= 3 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // G5: Strong emissions but extreme concentration → don't upgrade (Bittensor: only >98%)
  if (input.economicContext.emissionsPercent > 2 && input.snapshot.stakeConcentration > 98 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // Slice top 3 positive/negative reasons
  const positiveReasons = allReasons.filter(r => r.positive).slice(0, 3).map(r => r.label);
  const negativeReasons = allReasons.filter(r => !r.positive).slice(0, 3).map(r => r.label);

  return {
    netuid: input.netuid,
    verdict,
    confidence,
    entryScore,
    holdScore,
    exitRisk,
    positiveReasons,
    negativeReasons,
    allReasons,
  };
}

/* ── Batch ── */

export function computeAllVerdicts(inputs: VerdictInput[]): VerdictResult[] {
  return inputs.map(computeVerdict);
}
