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
};

export type RadarScores = {
  healthIndex: number;
  capitalMomentum: number;
  dumpRisk: number;
  subnetRadarScore: number;
  narrativeScore: number;
  smartMoneyScore: number;
  bubbleScore: number;           // 0-100 — price vs adoption divergence
  manipulationScore: number;     // 0-100 — validator capture risk
  alphaInefficiency: number;     // % deviation from fair value
  fairAlphaPrice: number;        // computed fair value
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
  bubbleOverheat: boolean;       // bubbleScore > 60
  bubbleAlert: boolean;          // bubbleScore > 75
  bubbleDump: boolean;           // bubbleScore > 85
  manipSuspicious: boolean;      // manipScore > 65
  manipRisk: boolean;            // manipScore > 80
  alphaUndervalued: boolean;     // inefficiency < -30%
  alphaOverpriced: boolean;      // inefficiency > +40%
};

/* ─── Score Computation ─── */

export function computeHealthIndex(s: StakeSnapshot, d: StakeDeltas): number {
  let score = 50;
  // Miners growth
  score += clamp(d.minersGrowth7d * 80, -20, 20);
  // Holders growth
  score += clamp(d.holdersGrowth7d * 60, -15, 15);
  // UID usage (higher = healthier)
  score += clamp(s.uidUsage * 20, 0, 15);
  // Validator decentralization
  if (s.validatorsActive >= 15) score += 10;
  else if (s.validatorsActive >= 8) score += 5;
  else if (s.validatorsActive <= 2) score -= 10;
  // Stake concentration penalty (high = bad)
  if (s.stakeConcentration > 80) score -= 15;
  else if (s.stakeConcentration > 60) score -= 10;
  else if (s.stakeConcentration > 40) score -= 5;
  return clamp(Math.round(score), 0, 100);
}

export function computeCapitalMomentum(s: StakeSnapshot, d: StakeDeltas): number {
  let score = 50;
  // Stake inflow velocity
  score += clamp(d.stakeChange7d * 150, -25, 25);
  // Holders growth
  score += clamp(d.holdersGrowth7d * 80, -15, 15);
  // Whale activity (net flow)
  const netWhaleFlow = s.largeWalletInflow - s.largeWalletOutflow;
  score += clamp(netWhaleFlow / 50, -10, 10);
  return clamp(Math.round(score), 0, 100);
}

export function computeDumpRisk(s: StakeSnapshot, d: StakeDeltas): number {
  let risk = 15;
  // Stake concentration (high = risky)
  if (s.stakeConcentration > 75) risk += 30;
  else if (s.stakeConcentration > 55) risk += 20;
  else if (s.stakeConcentration > 35) risk += 10;
  // Stake outflow
  if (d.stakeChange7d < -0.15) risk += 25;
  else if (d.stakeChange7d < -0.05) risk += 15;
  else if (d.stakeChange7d < 0) risk += 5;
  // Miner decline
  if (d.minersGrowth7d < -0.15) risk += 15;
  else if (d.minersGrowth7d < -0.05) risk += 10;
  else if (d.minersGrowth7d < 0) risk += 5;
  // Validator centralization
  if (s.validatorsActive <= 2) risk += 10;
  else if (s.validatorsActive <= 5) risk += 5;
  // Whale selling
  if (s.largeWalletOutflow > s.largeWalletInflow * 2) risk += 10;
  return clamp(Math.round(risk), 0, 100);
}

/* ─── Subnet Radar Score (Module 1) ─── */
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

/* ─── Narrative Score (Module 3) ─── */
export function computeNarrativeScore(_s: StakeSnapshot, d: StakeDeltas): number {
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const holdersGrowth = clamp(d.holdersGrowth7d * 100, 0, 100);
  const stakeInflow = clamp(d.stakeChange7d * 100, 0, 100);
  return clamp(Math.round(0.35 * minersGrowth + 0.35 * holdersGrowth + 0.30 * stakeInflow), 0, 100);
}

/* ─── Smart Money Score (Module 2) ─── */
export function computeSmartMoneyScore(s: StakeSnapshot, d: StakeDeltas): number {
  let score = 0;
  const inflow = s.largeWalletInflow;
  const outflow = s.largeWalletOutflow;
  const netFlow = inflow - outflow;
  score += clamp(netFlow * 2, 0, 40);
  score += clamp(d.stakeChange7d * 200, 0, 30);
  if (s.stakeConcentration > 60) score += 15;
  else if (s.stakeConcentration > 30) score += 10;
  score += clamp(s.uidUsage * 15, 0, 15);
  return clamp(Math.round(score), 0, 100);
}

/* ─── Bubble Score ─── */
export type PriceContext = {
  priceChange7d: number;   // fractional
  priceChange30d: number;  // fractional
  currentPrice: number;
  liquidity: number;
  emission: number;        // from raw_data.chain.emission
};

export function computeBubbleScore(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  const priceGrowth = clamp(p.priceChange7d * 100, 0, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const holdersGrowth = clamp(d.holdersGrowth7d * 100, 0, 100);
  const stakeGrowth = clamp(d.stakeChange7d * 100, 0, 100);
  return clamp(Math.round(
    0.40 * priceGrowth - 0.25 * minersGrowth - 0.20 * holdersGrowth - 0.15 * stakeGrowth
  ), 0, 100);
}

/* ─── Manipulation Score ─── */
export function computeManipulationScore(s: StakeSnapshot): number {
  let score = 0;
  const valEmissionPct = s.validatorsActive > 0 ? clamp(s.stakeConcentration, 0, 100) : 0;
  score += 0.35 * valEmissionPct;
  const valConcentration = s.validatorsActive <= 2 ? 90 : s.validatorsActive <= 5 ? 70 : s.validatorsActive <= 10 ? 40 : 15;
  score += 0.30 * valConcentration;
  const rewardSkew = s.validatorsActive <= 3 && s.stakeConcentration > 50 ? 80 : s.stakeConcentration > 70 ? 60 : 20;
  score += 0.20 * rewardSkew;
  const lowMinerRewards = s.minersActive <= 2 ? 80 : s.minersActive <= 10 ? 50 : s.uidUsage < 0.1 ? 40 : 10;
  score += 0.15 * lowMinerRewards;
  return clamp(Math.round(score), 0, 100);
}

/* ─── Alpha Price Inefficiency ─── */
export function computeFairAlphaPrice(s: StakeSnapshot, p: PriceContext): number {
  const minersLog = s.minersActive > 0 ? Math.log(s.minersActive + 1) / Math.log(256) : 0;
  const stakeNorm = clamp(s.stakeTotal / 1e6, 0, 1);
  const burnRate = clamp(p.emission / 1e9, 0, 1);
  const uidUsage = s.uidUsage;
  const liqDepth = clamp(p.liquidity / 1e6, 0, 1);
  const fairScore = 0.35 * minersLog + 0.25 * stakeNorm + 0.15 * burnRate + 0.15 * uidUsage + 0.10 * liqDepth;
  return fairScore * 100;
}

export function computeAlphaInefficiency(realPrice: number, fairPrice: number): number {
  if (fairPrice <= 0) return 0;
  return ((realPrice - fairPrice) / fairPrice) * 100;
}

export function computeRadarScores(s: StakeSnapshot, d: StakeDeltas, p?: PriceContext): RadarScores {
  const pc: PriceContext = p || { priceChange7d: 0, priceChange30d: 0, currentPrice: 0, liquidity: 0, emission: 0 };
  const fairAlpha = computeFairAlphaPrice(s, pc);
  return {
    healthIndex: computeHealthIndex(s, d),
    capitalMomentum: computeCapitalMomentum(s, d),
    dumpRisk: computeDumpRisk(s, d),
    subnetRadarScore: computeSubnetRadarScore(s, d),
    narrativeScore: computeNarrativeScore(s, d),
    smartMoneyScore: computeSmartMoneyScore(s, d),
    bubbleScore: computeBubbleScore(s, d, pc),
    manipulationScore: computeManipulationScore(s),
    alphaInefficiency: computeAlphaInefficiency(pc.currentPrice, fairAlpha),
    fairAlphaPrice: fairAlpha,
  };
}

/* ─── Alert Conditions ─── */

export function checkAlerts(s: StakeSnapshot, d: StakeDeltas, p?: PriceContext): RadarAlerts {
  const scores = computeRadarScores(s, d, p);
  return {
    earlyAdoption: scores.subnetRadarScore > 70,
    narrativeStarting: scores.subnetRadarScore > 85,
    narrativeForming: scores.narrativeScore > 80,
    smartMoneySignal: s.largeWalletInflow > 5 && d.stakeChange7d > 0.10,
    whaleAccumulation: d.stakeChange7d > 0.25 && s.largeWalletInflow > 3,
    dumpRiskAlert: s.stakeConcentration > 50 && d.minersGrowth7d < 0 && d.stakeChange7d < -0.20,
    dumpWarning: scores.dumpRisk > 60,
    dumpExit: scores.dumpRisk > 75,
    bubbleOverheat: scores.bubbleScore > 60,
    bubbleAlert: scores.bubbleScore > 75,
    bubbleDump: scores.bubbleScore > 85,
    manipSuspicious: scores.manipulationScore > 65,
    manipRisk: scores.manipulationScore > 80,
    alphaUndervalued: scores.alphaInefficiency < -30 && (p?.currentPrice ?? 0) > 0,
    alphaOverpriced: scores.alphaInefficiency > 40 && (p?.currentPrice ?? 0) > 0,
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
