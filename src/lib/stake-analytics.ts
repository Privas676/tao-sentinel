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
  healthIndex: number;       // 0-100
  capitalMomentum: number;   // 0-100
  dumpRisk: number;          // 0-100
  subnetRadarScore: number;  // 0-100 — adoption précoce
  narrativeScore: number;    // 0-100 — potentiel viral
  smartMoneyScore: number;   // 0-100 — activité whale
};

export type RadarAlerts = {
  earlyAdoption: boolean;       // radarScore > 70
  narrativeStarting: boolean;   // radarScore > 85
  narrativeForming: boolean;    // narrativeScore > 80
  smartMoneySignal: boolean;    // whale conditions
  whaleAccumulation: boolean;
  dumpRiskAlert: boolean;
  dumpWarning: boolean;         // dumpRisk > 60
  dumpExit: boolean;            // dumpRisk > 75
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

export function computeRadarScores(s: StakeSnapshot, d: StakeDeltas): RadarScores {
  return {
    healthIndex: computeHealthIndex(s, d),
    capitalMomentum: computeCapitalMomentum(s, d),
    dumpRisk: computeDumpRisk(s, d),
    subnetRadarScore: computeSubnetRadarScore(s, d),
    narrativeScore: computeNarrativeScore(s, d),
    smartMoneyScore: computeSmartMoneyScore(s, d),
  };
}

/* ─── Alert Conditions ─── */

export function checkAlerts(s: StakeSnapshot, d: StakeDeltas): RadarAlerts {
  const scores = computeRadarScores(s, d);
  return {
    earlyAdoption: scores.subnetRadarScore > 70,
    narrativeStarting: scores.subnetRadarScore > 85,
    narrativeForming: scores.narrativeScore > 80,
    smartMoneySignal:
      s.largeWalletInflow > 5 && d.stakeChange7d > 0.10,
    whaleAccumulation:
      d.stakeChange7d > 0.25 && s.largeWalletInflow > 3,
    dumpRiskAlert:
      s.stakeConcentration > 50 && d.minersGrowth7d < 0 && d.stakeChange7d < -0.20,
    dumpWarning: scores.dumpRisk > 60,
    dumpExit: scores.dumpRisk > 75,
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
  // 0 = cold (blue), 50 = neutral, 100 = hot (red)
  if (value >= 80) return "rgba(229,57,53,0.7)";
  if (value >= 60) return "rgba(255,109,0,0.6)";
  if (value >= 40) return "rgba(255,193,7,0.5)";
  if (value >= 20) return "rgba(76,175,80,0.4)";
  return "rgba(100,181,246,0.3)";
}
