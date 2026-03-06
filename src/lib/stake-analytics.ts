/* ═══════════════════════════════════════ */
/*   STAKE ANALYTICS ENGINE                */
/*   Health Index · Capital Momentum ·     */
/*   Dump Risk from on-chain stake data    */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-engine";

/* ─── Types ─── */

export type StakeSnapshot = {
  netuid: number;
  holdersCount: number;
  stakeTotal: number;
  stakeConcentration: number; // 0-100 (top10 share %)
  top10Stake: { address: string; stake: number; pct: number }[];
  validatorsActive: number;
  minersTotal: number;
  minersActive: number;
  uidUsage: number; // 0-1
  largeWalletInflow: number;
  largeWalletOutflow: number;
};

export type StakeDeltas = {
  stakeChange24h: number; // fractional change
  stakeChange7d: number;
  holdersGrowth7d: number;
  holdersGrowth30d: number;
  minersGrowth7d: number;
  validatorsGrowth7d: number;
};

export type PriceContext = {
  priceChange1d: number;   // % change (already percentage)
  priceChange7d: number;   // % change
  priceChange30d: number;  // % change
  currentPrice: number;
  liquidity: number;
  emission: number;
  emissionShare: number;   // % of total network emission
  marketCap: number;       // in TAO
  vol24h: number;          // in TAO
  fearGreed: number;       // 0-100
};

export type RadarScores = {
  healthIndex: number;
  capitalMomentum: number;
  dumpRisk: number;
  subnetRadarScore: number;
  narrativeScore: number;
  smartMoneyScore: number;
  bubbleScore: number;
  manipulationScore: number;
  alphaInefficiency: number;
  fairAlphaPrice: number;
};

export type RadarAlerts = {
  earlyAdoption: boolean;
  narrativeStarting: boolean;
  narrativeForming: boolean;
  smartMoneySignal: boolean;
  whaleAccumulation: boolean;
  dumpRiskAlert: boolean;
  dumpWarning: boolean;
  dumpExit: boolean;
  bubbleOverheat: boolean;
  bubbleAlert: boolean;
  bubbleDump: boolean;
  manipSuspicious: boolean;
  manipRisk: boolean;
  alphaUndervalued: boolean;
  alphaOverpriced: boolean;
};

/* ─── Score Computation ─── */

export function computeHealthIndex(s: StakeSnapshot, d: StakeDeltas): number {
  let score = 50;
  score += clamp(d.minersGrowth7d * 80, -20, 20);
  score += clamp(d.holdersGrowth7d * 60, -15, 15);
  score += clamp(s.uidUsage * 20, 0, 15);
  if (s.validatorsActive >= 15) score += 10;
  else if (s.validatorsActive >= 8) score += 5;
  else if (s.validatorsActive <= 2) score -= 10;
  if (s.stakeConcentration > 80) score -= 15;
  else if (s.stakeConcentration > 60) score -= 10;
  else if (s.stakeConcentration > 40) score -= 5;
  return clamp(Math.round(score), 0, 100);
}

export function computeCapitalMomentum(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  let score = 50;
  // Stake inflow velocity
  score += clamp(d.stakeChange7d * 150, -25, 25);
  // Holders growth
  score += clamp(d.holdersGrowth7d * 80, -15, 15);
  // Price momentum (7d % change)
  score += clamp(p.priceChange7d / 5, -10, 10);
  // Whale activity (net flow)
  const netWhaleFlow = s.largeWalletInflow - s.largeWalletOutflow;
  if (netWhaleFlow > 100) score += 10;
  else if (netWhaleFlow > 10) score += 5;
  else if (netWhaleFlow < -100) score -= 10;
  else if (netWhaleFlow < -10) score -= 5;
  return clamp(Math.round(score), 0, 100);
}

export function computeDumpRisk(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  let risk = 10;
  // Stake concentration (high = risky)
  if (s.stakeConcentration > 75) risk += 20;
  else if (s.stakeConcentration > 55) risk += 12;
  else if (s.stakeConcentration > 35) risk += 6;
  // Price decline (continuous, using 7d for more differentiation)
  if (p.priceChange7d < -15) risk += 20;
  else if (p.priceChange7d < -8) risk += 15;
  else if (p.priceChange7d < -3) risk += 10;
  else if (p.priceChange7d < 0) risk += clamp(Math.abs(p.priceChange7d) * 2, 0, 8);
  // 1d volatility spike
  if (p.priceChange1d < -10) risk += 12;
  else if (p.priceChange1d < -5) risk += 8;
  else if (p.priceChange1d < -2) risk += 4;
  // Low liquidity ratio (vol/mcap) — continuous scale
  const liqRatio = p.marketCap > 0 ? p.vol24h / p.marketCap : 0;
  if (liqRatio < 0.001) risk += 12;
  else if (liqRatio < 0.005) risk += 8;
  else if (liqRatio < 0.01) risk += 4;
  else if (liqRatio > 0.15) risk += 6; // Abnormally high vol = potential dump in progress
  // Miner decline
  if (d.minersGrowth7d < -0.15) risk += 10;
  else if (d.minersGrowth7d < -0.05) risk += 6;
  // Low emission = less incentive to stay
  if (p.emissionShare < 0.1 && p.emissionShare >= 0) risk += 8;
  else if (p.emissionShare < 0.5) risk += 4;
  // Validator centralization (only if we have data)
  if (s.validatorsActive > 0) {
    if (s.validatorsActive <= 2) risk += 8;
    else if (s.validatorsActive <= 5) risk += 4;
  }
  // Stake outflow
  if (d.stakeChange7d < -0.15) risk += 12;
  else if (d.stakeChange7d < -0.05) risk += 8;
  else if (d.stakeChange7d < 0) risk += clamp(Math.abs(d.stakeChange7d) * 40, 0, 6);
  return clamp(Math.round(risk), 0, 100);
}

/* ─── Subnet Radar Score ─── */
export function computeSubnetRadarScore(s: StakeSnapshot, d: StakeDeltas): number {
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const holdersGrowth = clamp(d.holdersGrowth7d * 100, 0, 100);
  const stakeInflow = clamp(d.stakeChange7d * 100, 0, 100);
  const uidUsage = clamp(s.uidUsage * 100, 0, 100);
  const validatorGrowth = clamp(s.validatorsActive >= 15 ? 80 : s.validatorsActive >= 8 ? 50 : s.validatorsActive >= 3 ? 30 : 10, 0, 100);
  return clamp(Math.round(
    0.25 * minersGrowth + 0.25 * holdersGrowth + 0.20 * stakeInflow + 0.15 * uidUsage + 0.15 * validatorGrowth
  ), 0, 100);
}

/* ─── Narrative Score ─── */
export function computeNarrativeScore(_s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  // Price momentum (% change already)
  const priceMomentum = clamp(p.priceChange7d, -100, 100);
  const stakeInflow = clamp(d.stakeChange7d * 100, -100, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, -100, 100);
  const validatorsGrowth = clamp(d.validatorsGrowth7d * 100, -100, 100);
  // Volume change proxy: high vol/mcap = high activity
  const volChange = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 500, 0, 100) : 0;

  const raw = 0.30 * priceMomentum + 0.25 * stakeInflow + 0.20 * minersGrowth + 0.15 * validatorsGrowth + 0.10 * volChange;
  return clamp(Math.round(raw), 0, 100);
}

/* ─── Smart Money Score ─── */
export function computeSmartMoneyScore(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  let score = 0;
  const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
  // Net flow contribution (scaled for real TAO amounts)
  if (netFlow > 100) score += 40;
  else if (netFlow > 50) score += 30;
  else if (netFlow > 10) score += 20;
  else if (netFlow > 0) score += 10;
  // Stake inflow
  score += clamp(d.stakeChange7d * 200, 0, 30);
  // Emission share (higher emission = more attractive)
  if (p.emissionShare > 5) score += 15;
  else if (p.emissionShare > 2) score += 10;
  else if (p.emissionShare > 0.5) score += 5;
  // Active miners = real network usage
  score += clamp(s.uidUsage * 15, 0, 15);
  return clamp(Math.round(score), 0, 100);
}

/* ─── Bubble Score ─── */
export function computeBubbleScore(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  // Price growth vs adoption divergence
  const priceGrowth = clamp(p.priceChange7d, 0, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const holdersGrowth = clamp(d.holdersGrowth7d * 100, 0, 100);
  const stakeGrowth = clamp(d.stakeChange7d * 100, 0, 100);
  // Liquidity ratio (vol/mcap — low = more bubble-like)
  const liqRatio = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 100, 0, 100) : 50;

  const raw = 0.40 * priceGrowth - 0.25 * minersGrowth - 0.20 * holdersGrowth - 0.15 * liqRatio;
  return clamp(Math.round(raw), 0, 100);
}

/* ─── Manipulation Score ─── */
export function computeManipulationScore(s: StakeSnapshot, p: PriceContext): number {
  let score = 0;
  // Validator concentration (fewer validators = more centralized)
  const valConcentration = s.validatorsActive <= 2 ? 90 : s.validatorsActive <= 5 ? 70 : s.validatorsActive <= 10 ? 40 : s.validatorsActive <= 15 ? 25 : 10;
  score += 0.35 * valConcentration;
  // Stake concentration as proxy for reward skew
  const stakeConc = clamp(s.stakeConcentration, 0, 100);
  score += 0.30 * stakeConc;
  // Emission share (high emission + low validators = suspicious)
  const emissionFactor = p.emissionShare > 5 && s.validatorsActive <= 5 ? 80 :
    p.emissionShare > 3 && s.validatorsActive <= 8 ? 50 :
    p.emissionShare > 1 ? 30 : 15;
  score += 0.20 * emissionFactor;
  // Low miner activity
  const lowMinerRewards = s.minersActive <= 2 ? 80 : s.minersActive <= 10 ? 50 : s.uidUsage < 0.1 ? 40 : 10;
  score += 0.15 * lowMinerRewards;
  return clamp(Math.round(score), 0, 100);
}

/* ─── Alpha Price Inefficiency ─── */
// Compute a fundamentals score (0-100) that represents the "real value" of a subnet
export function computeFundamentalsScore(s: StakeSnapshot, p: PriceContext): number {
  // Miners activity (log scale, 256 max = 100%)
  const minersScore = s.minersActive > 0 ? clamp(Math.log(s.minersActive + 1) / Math.log(257) * 100, 0, 100) : 0;
  // Stake depth (log scale)
  const stakeScore = s.stakeTotal > 0 ? clamp(Math.log(s.stakeTotal + 1) / Math.log(1e7) * 100, 0, 100) : 0;
  // Emission share
  const emissionScore = clamp(p.emissionShare * 10, 0, 100);
  // Volume activity
  const volScore = p.vol24h > 0 ? clamp(Math.log(p.vol24h + 1) / Math.log(1e5) * 100, 0, 100) : 0;
  // Liquidity ratio
  const liqScore = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 1000, 0, 100) : 0;

  return 0.35 * minersScore + 0.25 * stakeScore + 0.20 * emissionScore + 0.10 * volScore + 0.10 * liqScore;
}

// Fair price is relative: median price * (this subnet's fundamentals / median fundamentals)
// This is called at the hook level with cross-subnet context
export function computeFairAlphaPrice(fundamentalsScore: number, medianPrice: number, medianFundamentals: number): number {
  if (medianFundamentals <= 0 || medianPrice <= 0) return 0;
  return medianPrice * (fundamentalsScore / medianFundamentals);
}

export function computeAlphaInefficiency(realPrice: number, fairPrice: number): number {
  if (fairPrice <= 0 || realPrice <= 0) return 0;
  return ((realPrice - fairPrice) / fairPrice) * 100;
}

export function computeRadarScores(s: StakeSnapshot, d: StakeDeltas, p: PriceContext, crossSubnet?: { medianPrice: number; medianFundamentals: number }): RadarScores {
  const fundamentals = computeFundamentalsScore(s, p);
  const fairAlpha = crossSubnet
    ? computeFairAlphaPrice(fundamentals, crossSubnet.medianPrice, crossSubnet.medianFundamentals)
    : 0;
  return {
    healthIndex: computeHealthIndex(s, d),
    capitalMomentum: computeCapitalMomentum(s, d, p),
    dumpRisk: computeDumpRisk(s, d, p),
    subnetRadarScore: computeSubnetRadarScore(s, d),
    narrativeScore: computeNarrativeScore(s, d, p),
    smartMoneyScore: computeSmartMoneyScore(s, d, p),
    bubbleScore: computeBubbleScore(s, d, p),
    manipulationScore: computeManipulationScore(s, p),
    alphaInefficiency: crossSubnet ? computeAlphaInefficiency(p.currentPrice, fairAlpha) : 0,
    fairAlphaPrice: fairAlpha,
  };
}

/* ─── Alert Conditions ─── */

export function checkAlerts(s: StakeSnapshot, d: StakeDeltas, scores: RadarScores, p: PriceContext): RadarAlerts {
  return {
    earlyAdoption: scores.subnetRadarScore > 70,
    narrativeStarting: scores.subnetRadarScore > 85,
    narrativeForming: scores.narrativeScore > 80,
    smartMoneySignal: (s.largeWalletInflow - s.largeWalletOutflow) > 10 && d.stakeChange7d > 0.05,
    whaleAccumulation: d.stakeChange7d > 0.25 && s.largeWalletInflow > 3,
    dumpRiskAlert: s.stakeConcentration > 50 && d.minersGrowth7d < 0 && d.stakeChange7d < -0.20,
    dumpWarning: scores.dumpRisk > 60,
    dumpExit: scores.dumpRisk > 75,
    bubbleOverheat: scores.bubbleScore > 60,
    bubbleAlert: scores.bubbleScore > 75,
    bubbleDump: scores.bubbleScore > 85,
    manipSuspicious: scores.manipulationScore > 65,
    manipRisk: scores.manipulationScore > 80,
    alphaUndervalued: scores.alphaInefficiency < -30 && p.currentPrice > 0 && scores.fairAlphaPrice > 0,
    alphaOverpriced: scores.alphaInefficiency > 40 && p.currentPrice > 0 && scores.fairAlphaPrice > 0,
  };
}

/* ─── Colors ─── */

export function healthIndexColor(score: number): string {
  if (score >= 70) return "rgba(76,175,80,0.8)";
  if (score >= 50) return "rgba(255,193,7,0.8)";
  if (score >= 30) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

export function momentumColor(score: number): string {
  if (score >= 65) return "rgba(76,175,80,0.8)";
  if (score >= 45) return "rgba(255,193,7,0.8)";
  return "rgba(229,57,53,0.7)";
}

export function dumpRiskColor(risk: number): string {
  if (risk >= 70) return "rgba(229,57,53,0.9)";
  if (risk >= 45) return "rgba(255,109,0,0.8)";
  if (risk >= 25) return "rgba(255,193,7,0.8)";
  return "rgba(76,175,80,0.7)";
}

export function heatmapColor(value: number): string {
  if (value >= 80) return "rgba(229,57,53,0.7)";
  if (value >= 60) return "rgba(255,109,0,0.6)";
  if (value >= 40) return "rgba(255,193,7,0.5)";
  if (value >= 20) return "rgba(76,175,80,0.4)";
  return "rgba(100,181,246,0.3)";
}

export function radarScoreColor(score: number): string {
  if (score >= 85) return "rgba(156,39,176,0.9)";
  if (score >= 70) return "rgba(76,175,80,0.8)";
  if (score >= 40) return "rgba(255,193,7,0.8)";
  return "rgba(255,255,255,0.3)";
}

export function narrativeScoreColor(score: number): string {
  if (score >= 80) return "rgba(156,39,176,0.9)";
  if (score >= 50) return "rgba(100,181,246,0.8)";
  return "rgba(255,255,255,0.3)";
}

export function smartMoneyColor(score: number): string {
  if (score >= 70) return "rgba(76,175,80,0.9)";
  if (score >= 40) return "rgba(255,193,7,0.8)";
  return "rgba(255,255,255,0.3)";
}

export function bubbleScoreColor(score: number): string {
  if (score >= 85) return "rgba(229,57,53,0.9)";
  if (score >= 75) return "rgba(229,57,53,0.7)";
  if (score >= 60) return "rgba(255,109,0,0.8)";
  return "rgba(255,255,255,0.3)";
}

export function manipulationScoreColor(score: number): string {
  if (score >= 80) return "rgba(229,57,53,0.9)";
  if (score >= 65) return "rgba(255,109,0,0.8)";
  if (score >= 40) return "rgba(255,193,7,0.8)";
  return "rgba(255,255,255,0.3)";
}

export function inefficiencyColor(pct: number): string {
  if (pct < -30) return "rgba(76,175,80,0.9)";
  if (pct < -10) return "rgba(76,175,80,0.6)";
  if (pct > 40) return "rgba(229,57,53,0.9)";
  if (pct > 15) return "rgba(255,109,0,0.7)";
  return "rgba(255,255,255,0.4)";
}
