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
};

export type RadarAlerts = {
  earlyAdoption: boolean;
  whaleAccumulation: boolean;
  dumpRiskAlert: boolean;
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

export function computeRadarScores(s: StakeSnapshot, d: StakeDeltas): RadarScores {
  return {
    healthIndex: computeHealthIndex(s, d),
    capitalMomentum: computeCapitalMomentum(s, d),
    dumpRisk: computeDumpRisk(s, d),
  };
}

/* ─── Alert Conditions ─── */

export function checkAlerts(s: StakeSnapshot, d: StakeDeltas): RadarAlerts {
  return {
    earlyAdoption:
      d.minersGrowth7d > 0.40 &&
      d.holdersGrowth7d > 0.40 &&
      d.stakeChange7d > 0.20,
    whaleAccumulation:
      d.stakeChange7d > 0.25 &&
      s.largeWalletInflow > 3,
    dumpRiskAlert:
      s.stakeConcentration > 50 &&
      d.minersGrowth7d < 0 &&
      d.stakeChange7d < -0.20,
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
