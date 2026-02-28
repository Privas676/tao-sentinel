/* ═══════════════════════════════════════ */
/*   SUBNET HEALTH ENGINE                   */
/*   Tokenomics-based scoring v1            */
/* ═══════════════════════════════════════ */

import { clamp } from "./gauge-engine";

/* ─── Types ─── */

export type SubnetHealthData = {
  netuid: number;
  // Tokenomics
  marketCap: number;
  fdv: number;
  circulatingSupply: number;
  totalSupply: number;
  burned: number;
  alphaPrice: number;    // TAO
  taoUsd: number;
  liquidityUsd: number;
  taoInPool: number;
  alphaInPool: number;
  // Emission & activity
  emissionPct: number;
  emissionPerDay: number;
  uidCount: number;
  maxUids: number;
  registrationCount: number;
  validatorWeight: number;
  minerWeight: number;
  alphaStaked: number;
  // Microstructure
  vol24h: number;
  buys24h: number;
  sells24h: number;
};

export type RecalculatedMetrics = {
  mcRecalc: number;
  fdvRecalc: number;
  dilutionRatio: number;
  volumeToMc: number;
  emissionToMc: number;
  liquidityRecalc: number;
  liquidityToMc: number;
};

export type HealthScores = {
  liquidityHealth: number;   // 0-100
  volumeHealth: number;      // 0-100
  emissionPressure: number;  // 0-100 (higher = more pressure = worse)
  dilutionRisk: number;      // 0-100 (higher = more dilution = worse)
  activityHealth: number;    // 0-100
};

export type SubnetHealthResult = {
  data: SubnetHealthData;
  recalc: RecalculatedMetrics;
  scores: HealthScores;
  riskComposite: number;    // 0-100
  opportunityRaw: number;   // 0-100 (before normalization)
};

/* ─── Extract health data from raw_payload ─── */

export function extractHealthData(
  netuid: number,
  rawPayload: any,
  chainData: any,
  taoUsd: number
): SubnetHealthData {
  const RAO = 1e9;
  const p = rawPayload || {};
  const c = chainData || {};

  // TaoStats: price is already in TAO (not RAO)
  const alphaPrice = Number(p.price ?? p.last_price) || 0;

  // Pool reserves: always in RAO from TaoStats
  const taoInPoolRaw = Number(p.protocol_provided_tao ?? p.tao_in_pool ?? 0);
  const taoInPool = taoInPoolRaw > 1e6 ? taoInPoolRaw / RAO : taoInPoolRaw;
  const alphaInPoolRaw = Number(p.protocol_provided_alpha ?? p.alpha_in_pool ?? 0);
  const alphaInPool = alphaInPoolRaw > 1e6 ? alphaInPoolRaw / RAO : alphaInPoolRaw;

  // Market cap: in RAO from TaoStats, convert to TAO
  const marketCapRaw = Number(p.market_cap ?? 0);
  const marketCap = marketCapRaw > 1e12 ? marketCapRaw / RAO : marketCapRaw;

  // Derive circulating supply from MC / price (TaoStats doesn't provide it directly)
  const circulatingSupply = alphaPrice > 0 ? marketCap / alphaPrice : 0;

  // Total supply: estimate from alpha_in_pool + alpha_staked + circulating
  // TaoStats doesn't expose total_supply directly; approximate via FDV if available
  const alphaStakedRaw = Number(p.alpha_staked ?? c.alpha_staked ?? 0);
  const alphaStaked = alphaStakedRaw > 1e6 ? alphaStakedRaw / RAO : alphaStakedRaw;
  const totalSupply = circulatingSupply > 0 ? circulatingSupply + alphaStaked + alphaInPool : 0;

  const burned = Number(p.burned ?? 0);

  // FDV: not always provided, derive from totalSupply * price
  const fdv = totalSupply > 0 ? totalSupply * alphaPrice : marketCap;

  // Liquidity: in RAO from TaoStats
  const liquidityRaw = Number(p.liquidity ?? 0);
  const liquidityTao = liquidityRaw > 1e6 ? liquidityRaw / RAO : liquidityRaw;
  // Liquidity USD = taoInPool * 2 * taoUsd (standard AMM formula)
  const liquidityUsd = taoInPool > 0 ? taoInPool * taoUsd * 2 : liquidityTao * taoUsd;

  // Volume 24h: in RAO from TaoStats
  const vol24hRaw = Number(p.tao_volume_24_hr ?? 0);
  const vol24h = vol24hRaw > 1e6 ? vol24hRaw / RAO : vol24hRaw;

  const buys24h = Number(p.buys_24_hr ?? 0);
  const sells24h = Number(p.sells_24_hr ?? 0);

  // Chain data (from _chain sub-object)
  // emission is in RAO units from TaoStats chain data
  const RAO_CHAIN = 1e9;
  const emissionRaw = Number(c.emission ?? 0);
  const emissionPct = emissionRaw > 1e6 ? emissionRaw / RAO_CHAIN : emissionRaw;
  const emissionPerDayRaw = Number(c.emission_per_day) || (emissionPct > 0 ? emissionPct * 7200 : 0);
  const emissionPerDay = emissionPerDayRaw > 1e6 ? emissionPerDayRaw / RAO_CHAIN : emissionPerDayRaw;
  const uidCount = Number(c.active_uids ?? 0);
  const maxUids = Number(c.max_n ?? 256);
  const registrationCount = Number(c.registrations ?? 0);
  const validatorWeight = Number(c.validator_weight ?? 0);
  const minerWeight = Number(c.miner_weight ?? 0);

  return {
    netuid, marketCap, fdv, circulatingSupply, totalSupply, burned,
    alphaPrice, taoUsd, liquidityUsd,
    taoInPool, alphaInPool,
    emissionPct, emissionPerDay, uidCount, maxUids, registrationCount,
    validatorWeight, minerWeight, alphaStaked,
    vol24h, buys24h, sells24h,
  };
}

/* ─── Recalculations (Section 2) ─── */

export function recalculate(data: SubnetHealthData): RecalculatedMetrics {
  // MC recalc: circulatingSupply * alphaPrice * taoUsd (all derived from real data)
  const mcRecalc = data.circulatingSupply > 0
    ? data.circulatingSupply * data.alphaPrice * data.taoUsd
    : data.marketCap * data.taoUsd;

  // FDV recalc: totalSupply * alphaPrice * taoUsd
  const fdvRecalc = data.totalSupply > 0
    ? data.totalSupply * data.alphaPrice * data.taoUsd
    : mcRecalc; // fallback to MC if no total supply

  const dilutionRatio = mcRecalc > 0 ? fdvRecalc / mcRecalc : 1;
  // Volume in USD / MC in USD
  const volumeToMc = mcRecalc > 0 ? (data.vol24h * data.taoUsd) / mcRecalc : 0;
  const emissionToMc = mcRecalc > 0
    ? (data.emissionPerDay * data.alphaPrice * data.taoUsd) / mcRecalc
    : 0;
  // Liquidity recalc: TAO in pool * taoUsd * 2 (standard AMM)
  const liquidityRecalc = data.taoInPool > 0
    ? data.taoInPool * data.taoUsd * 2
    : data.liquidityUsd;
  const liquidityToMc = mcRecalc > 0 ? liquidityRecalc / mcRecalc : 0;

  return { mcRecalc, fdvRecalc, dilutionRatio, volumeToMc, emissionToMc, liquidityRecalc, liquidityToMc };
}

/* ─── Health Metrics (Section 4) ─── */

export function computeLiquidityHealth(liquidityToMc: number, liquidityUsd: number): number {
  // >1% of MC = healthy, 0.3-1% = warning, <0.3% = critical
  let score = 50;
  if (liquidityToMc > 0.01) score = 80 + clamp((liquidityToMc - 0.01) * 500, 0, 20);
  else if (liquidityToMc > 0.003) score = 40 + (liquidityToMc - 0.003) / 0.007 * 40;
  else if (liquidityToMc > 0) score = clamp(liquidityToMc / 0.003 * 40, 5, 40);
  else score = 5;

  // Absolute liquidity floor: <$10k is always bad
  if (liquidityUsd < 10000) score = Math.min(score, 25);
  else if (liquidityUsd < 50000) score = Math.min(score, 50);

  // Slippage estimate penalty: if liq < 0.5% MC, estimated slippage > 5%
  if (liquidityToMc < 0.005) score -= 10;

  return clamp(Math.round(score), 0, 100);
}

export function computeVolumeHealth(volumeToMc: number): number {
  // 1-10% = healthy, <0.5% = illiquid, >20% = speculative
  let score: number;
  if (volumeToMc >= 0.01 && volumeToMc <= 0.10) {
    score = 70 + clamp((volumeToMc - 0.01) / 0.09 * 30, 0, 30);
  } else if (volumeToMc > 0.10 && volumeToMc <= 0.20) {
    score = 70 - (volumeToMc - 0.10) / 0.10 * 20;
  } else if (volumeToMc > 0.20) {
    score = clamp(50 - (volumeToMc - 0.20) * 200, 10, 50);
  } else if (volumeToMc >= 0.005) {
    score = 40 + (volumeToMc - 0.005) / 0.005 * 30;
  } else {
    score = volumeToMc / 0.005 * 40;
  }
  return clamp(Math.round(score), 5, 100);
}

export function computeEmissionPressure(emissionToMc: number): number {
  // Higher = more sell pressure = worse (inverted for risk)
  // emissionToMc < 0.001/day = low, 0.001-0.005 = moderate, >0.005 = high
  if (emissionToMc <= 0.0005) return 10;
  if (emissionToMc <= 0.001) return 20;
  if (emissionToMc <= 0.003) return 30 + (emissionToMc - 0.001) / 0.002 * 20;
  if (emissionToMc <= 0.005) return 50 + (emissionToMc - 0.003) / 0.002 * 15;
  if (emissionToMc <= 0.01) return 65 + (emissionToMc - 0.005) / 0.005 * 15;
  return clamp(Math.round(80 + (emissionToMc - 0.01) * 1000), 80, 100);
}

export function computeDilutionRisk(dilutionRatio: number): number {
  // <1.5 = low risk, 1.5-3 = moderate, 3-5 = high, >5 = very high
  if (dilutionRatio <= 1.2) return 5;
  if (dilutionRatio <= 1.5) return 15;
  if (dilutionRatio <= 2.0) return 25;
  if (dilutionRatio <= 3.0) return 35 + (dilutionRatio - 2) * 15;
  if (dilutionRatio <= 5.0) return 50 + (dilutionRatio - 3) * 10;
  return clamp(Math.round(70 + (dilutionRatio - 5) * 5), 70, 100);
}

export function computeActivityHealth(data: SubnetHealthData): number {
  let score = 50;

  // UID utilization
  const uidRatio = data.maxUids > 0 ? data.uidCount / data.maxUids : 0;
  if (uidRatio >= 0.9) score += 20;
  else if (uidRatio >= 0.6) score += 10;
  else if (uidRatio >= 0.3) score += 0;
  else if (uidRatio > 0) score -= 10;
  else score -= 25; // No UIDs = critical

  // Registration activity
  if (data.registrationCount > 10) score += 10;
  else if (data.registrationCount > 3) score += 5;
  else if (data.registrationCount === 0) score -= 5;

  // Alpha staked (engagement)
  if (data.alphaStaked > 1000) score += 10;
  else if (data.alphaStaked > 100) score += 5;

  // Emission zero = critical (subnet not producing)
  if (data.emissionPct === 0 && data.uidCount === 0) score -= 20;

  return clamp(Math.round(score), 0, 100);
}

export function computeAllHealthScores(data: SubnetHealthData, recalc: RecalculatedMetrics): HealthScores {
  return {
    liquidityHealth: computeLiquidityHealth(recalc.liquidityToMc, data.liquidityUsd),
    volumeHealth: computeVolumeHealth(recalc.volumeToMc),
    emissionPressure: computeEmissionPressure(recalc.emissionToMc),
    dilutionRisk: computeDilutionRisk(recalc.dilutionRatio),
    activityHealth: computeActivityHealth(data),
  };
}

/* ─── Composite Risk (Section 5) ─── */

export function computeHealthRisk(scores: HealthScores, dataConsistencyRisk: number): number {
  // Invert health scores to risk: high health = low risk
  const liquidityRisk = 100 - scores.liquidityHealth;
  const activityRisk = 100 - scores.activityHealth;

  const risk =
    liquidityRisk * 0.25 +
    scores.emissionPressure * 0.20 +
    scores.dilutionRisk * 0.20 +
    activityRisk * 0.20 +
    dataConsistencyRisk * 0.15;

  return clamp(Math.round(risk), 0, 100);
}

/* ─── Composite Opportunity (Section 6) ─── */

export function computeHealthOpportunity(
  momentumScore: number,
  scores: HealthScores,
  smartCapitalScore: number,
  preHypeIntensity: number,
  recalc: RecalculatedMetrics
): number {
  let opp =
    momentumScore * 0.30 +
    scores.volumeHealth * 0.20 +
    scores.activityHealth * 0.20 +
    smartCapitalScore * 0.15 +
    preHypeIntensity * 0.15;

  // Penalties (Section 6 caveats)
  if (recalc.dilutionRatio > 5) opp *= 0.7;
  else if (recalc.dilutionRatio > 3) opp *= 0.85;

  if (scores.liquidityHealth < 25) opp *= 0.6;
  else if (scores.liquidityHealth < 40) opp *= 0.8;

  if (scores.emissionPressure > 70) opp *= 0.75;
  else if (scores.emissionPressure > 50) opp *= 0.9;

  return clamp(Math.round(opp), 0, 100);
}

/* ─── Full pipeline for a single subnet ─── */

export function computeSubnetHealth(
  netuid: number,
  rawPayload: any,
  chainData: any,
  taoUsd: number,
  dataConsistencyRisk: number,
  momentumScore: number,
  smartCapitalScore: number,
  preHypeIntensity: number
): SubnetHealthResult {
  const data = extractHealthData(netuid, rawPayload, chainData, taoUsd);
  const recalc = recalculate(data);
  const scores = computeAllHealthScores(data, recalc);
  const riskComposite = computeHealthRisk(scores, dataConsistencyRisk);
  const opportunityRaw = computeHealthOpportunity(momentumScore, scores, smartCapitalScore, preHypeIntensity, recalc);

  return { data, recalc, scores, riskComposite, opportunityRaw };
}

/* ─── Health score colors ─── */

export function healthColor(score: number, inverted = false): string {
  const effective = inverted ? 100 - score : score;
  if (effective >= 70) return "rgba(76,175,80,0.8)";
  if (effective >= 45) return "rgba(255,193,7,0.8)";
  if (effective >= 25) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

export function dilutionLabel(ratio: number): string {
  if (ratio <= 1.5) return "Faible";
  if (ratio <= 3) return "Modéré";
  if (ratio <= 5) return "Élevé";
  return "Très élevé";
}

export function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
