/* ═══════════════════════════════════════ */
/*   STAKE ANALYTICS ENGINE                */
/*   Full Bittensor Economic Model         */
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
  // Network
  uidUsed: number;
  uidMax: number;
  registrationCost: number;
  incentiveBurn: number;
  recyclePerDay: number;
};

export type EconomicContext = {
  // Economics
  emissionsPercent: number;
  emissionsPerDay: number;
  minerPerDay: number;
  validatorPerDay: number;
  ownerPerDay: number;
  rootProportion: number;
  totalIssued: number;
  totalBurned: number;
  circulatingSupply: number;
  maxSupply: number;
  // Liquidity
  alphaStaked: number;
  alphaInPool: number;
  taoInPool: number;
  alphaPoolPercent: number;
  taoPoolPercent: number;
  fdv: number;
  volumeMarketcapRatio: number;
  // Trading
  buyVolume: number;
  sellVolume: number;
  buyersCount: number;
  sellersCount: number;
  buyTxCount: number;
  sellTxCount: number;
  sentiment: number; // buy_volume / (buy_volume + sell_volume)
};

export type StakeDeltas = {
  stakeChange24h: number;
  stakeChange7d: number;
  holdersGrowth7d: number;
  holdersGrowth30d: number;
  minersGrowth7d: number;
  validatorsGrowth7d: number;
};

export type PriceContext = {
  priceChange1d: number;
  priceChange7d: number;
  priceChange30d: number;
  currentPrice: number;
  liquidity: number;
  emission: number;
  emissionShare: number;
  marketCap: number;
  vol24h: number;
  fearGreed: number;
};

/* ─── Derived Metrics ─── */

export type DerivedMetrics = {
  uidSaturation: number;       // uid_used / uid_max (0-1)
  emissionPower: number;       // emissions_percent * emissions_per_day
  emissionEfficiency: number;  // emissions_per_day / market_cap
  poolBalance: number;         // tao_pool_percent / alpha_pool_percent
  tradingPressure: number;     // buy_volume - sell_volume
  burnRatio: number;           // recycled_per_day / emissions_per_day (actual burn rate)
};

export function computeDerivedMetrics(eco: EconomicContext, p: PriceContext, s: StakeSnapshot): DerivedMetrics {
  return {
    uidSaturation: s.uidMax > 0 ? s.uidUsed / s.uidMax : 0,
    emissionPower: eco.emissionsPercent * eco.emissionsPerDay,
    emissionEfficiency: p.marketCap > 0 ? eco.emissionsPerDay / p.marketCap : 0,
    poolBalance: eco.alphaPoolPercent > 0 ? eco.taoPoolPercent / eco.alphaPoolPercent : 0,
    tradingPressure: eco.buyVolume - eco.sellVolume,
    burnRatio: eco.emissionsPerDay > 0 ? s.recyclePerDay / eco.emissionsPerDay : 0,
  };
}

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

/* ─── Capital Flow (REFACTORED) ─── */
export function computeCapitalMomentum(s: StakeSnapshot, d: StakeDeltas, p: PriceContext, eco?: EconomicContext, dm?: DerivedMetrics): number {
  let score = 50;
  // Net stake flow
  const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
  score += clamp(d.stakeChange7d * 150, -25, 25);
  // Volume/MCap ratio (real liquidity activity)
  const volMcap = eco?.volumeMarketcapRatio ?? (p.marketCap > 0 ? p.vol24h / p.marketCap : 0);
  score += clamp(volMcap * 200, 0, 15);
  // Stake growth
  score += clamp(d.holdersGrowth7d * 80, -10, 10);
  // Whale flow
  if (netFlow > 100) score += 10;
  else if (netFlow > 10) score += 5;
  else if (netFlow < -100) score -= 10;
  else if (netFlow < -10) score -= 5;
  // Trading pressure (buy - sell)
  if (dm && dm.tradingPressure !== 0) {
    const pressureNorm = p.marketCap > 0 ? dm.tradingPressure / p.marketCap : 0;
    score += clamp(pressureNorm * 500, -10, 10);
  }
  return clamp(Math.round(score), 0, 100);
}

/* ─── Dump Risk (REFACTORED) ─── */
export function computeDumpRisk(s: StakeSnapshot, d: StakeDeltas, p: PriceContext, eco?: EconomicContext, dm?: DerivedMetrics): number {
  let risk = 10;
  // Liquidity drop: pool imbalance
  if (dm && dm.poolBalance > 0) {
    if (dm.poolBalance < 0.3) risk += 12;      // very imbalanced
    else if (dm.poolBalance < 0.6) risk += 8;
    else if (dm.poolBalance > 3) risk += 6;     // alpha-heavy pool
  }
  // Stake outflow
  if (d.stakeChange7d < -0.15) risk += 12;
  else if (d.stakeChange7d < -0.05) risk += 8;
  else if (d.stakeChange7d < 0) risk += clamp(Math.abs(d.stakeChange7d) * 40, 0, 6);
  // Pool imbalance (sell pressure)
  if (eco && (eco.buyVolume + eco.sellVolume) > 0) {
    const sellPressure = eco.sellVolume / (eco.buyVolume + eco.sellVolume);
    if (sellPressure > 0.7) risk += 12;
    else if (sellPressure > 0.55) risk += 8;
    else if (sellPressure > 0.45) risk += 4;
  } else {
    // Fallback: price-based
    if (p.priceChange1d < -10) risk += 12;
    else if (p.priceChange1d < -5) risk += 8;
    else if (p.priceChange1d < -2) risk += 4;
  }
  // UID saturation stress
  if (dm && dm.uidSaturation > 0) {
    if (dm.uidSaturation > 0.95) risk += 8;
    else if (dm.uidSaturation > 0.85) risk += 4;
  }
  // Vol/MCap anomaly
  const liqRatio = p.marketCap > 0 ? p.vol24h / p.marketCap : 0;
  if (liqRatio < 0.001) risk += 10;
  else if (liqRatio < 0.005) risk += 6;
  else if (liqRatio > 0.15) risk += 6;
  // Stake concentration
  if (s.stakeConcentration > 75) risk += 15;
  else if (s.stakeConcentration > 55) risk += 10;
  else if (s.stakeConcentration > 35) risk += 5;
  // Low emission
  if (p.emissionShare < 0.1 && p.emissionShare >= 0) risk += 6;
  else if (p.emissionShare < 0.5) risk += 3;
  // Validator centralization
  if (s.validatorsActive > 0 && s.validatorsActive <= 2) risk += 6;
  else if (s.validatorsActive > 0 && s.validatorsActive <= 5) risk += 3;
  // Miner decline
  if (d.minersGrowth7d < -0.15) risk += 8;
  else if (d.minersGrowth7d < -0.05) risk += 4;
  return clamp(Math.round(risk), 0, 100);
}

/* ─── Subnet Radar / Adoption (REFACTORED) ─── */
export function computeSubnetRadarScore(s: StakeSnapshot, d: StakeDeltas, dm?: DerivedMetrics): number {
  // UID saturation (0-100)
  const uidSat = dm ? clamp(dm.uidSaturation * 100, 0, 100) : clamp(s.uidUsage * 100, 0, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const validatorsGrowth = clamp(
    s.validatorsActive >= 15 ? 80 : s.validatorsActive >= 8 ? 50 : s.validatorsActive >= 3 ? 30 : 10,
    0, 100
  );
  // AdoptionScore = 0.4 * uid_saturation + 0.3 * miners_growth + 0.3 * validators_growth
  return clamp(Math.round(0.40 * uidSat + 0.30 * minersGrowth + 0.30 * validatorsGrowth), 0, 100);
}

/* ─── Narrative Score ─── */
export function computeNarrativeScore(_s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  const priceMomentum = clamp(p.priceChange7d, -100, 100);
  const stakeInflow = clamp(d.stakeChange7d * 100, -100, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, -100, 100);
  const validatorsGrowth = clamp(d.validatorsGrowth7d * 100, -100, 100);
  const volChange = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 500, 0, 100) : 0;
  const raw = 0.30 * priceMomentum + 0.25 * stakeInflow + 0.20 * minersGrowth + 0.15 * validatorsGrowth + 0.10 * volChange;
  return clamp(Math.round(raw), 0, 100);
}

/* ─── Smart Money (REFACTORED) ─── */
export function computeSmartMoneyScore(s: StakeSnapshot, d: StakeDeltas, p: PriceContext, eco?: EconomicContext): number {
  let score = 0;
  // Trading pressure: buy vs sell volume
  if (eco && (eco.buyVolume + eco.sellVolume) > 0) {
    const buyRatio = eco.buyVolume / (eco.buyVolume + eco.sellVolume);
    score += clamp(buyRatio * 50, 0, 50);
    // Buyer growth proxy: more buyers than sellers
    if (eco.buyersCount > eco.sellersCount * 1.5) score += 15;
    else if (eco.buyersCount > eco.sellersCount) score += 8;
  } else {
    // Fallback: whale net flow
    const netFlow = s.largeWalletInflow - s.largeWalletOutflow;
    if (netFlow > 100) score += 40;
    else if (netFlow > 50) score += 30;
    else if (netFlow > 10) score += 20;
    else if (netFlow > 0) score += 10;
  }
  // Whale activity (stake inflow)
  score += clamp(d.stakeChange7d * 200, 0, 20);
  // Emission share (higher = more attractive)
  if (p.emissionShare > 5) score += 15;
  else if (p.emissionShare > 2) score += 10;
  else if (p.emissionShare > 0.5) score += 5;
  // Active miners = real usage
  score += clamp(s.uidUsage * 15, 0, 15);
  return clamp(Math.round(score), 0, 100);
}

/* ─── Bubble Score ─── */
export function computeBubbleScore(s: StakeSnapshot, d: StakeDeltas, p: PriceContext): number {
  const priceGrowth = clamp(p.priceChange7d, 0, 100);
  const minersGrowth = clamp(d.minersGrowth7d * 100, 0, 100);
  const holdersGrowth = clamp(d.holdersGrowth7d * 100, 0, 100);
  const liqRatio = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 100, 0, 100) : 50;
  const raw = 0.40 * priceGrowth - 0.25 * minersGrowth - 0.20 * holdersGrowth - 0.15 * liqRatio;
  return clamp(Math.round(raw), 0, 100);
}

/* ─── Manipulation Score ─── */
export function computeManipulationScore(s: StakeSnapshot, p: PriceContext): number {
  let score = 0;
  let valConcentration: number;
  if (s.validatorsActive > 0) {
    valConcentration = s.validatorsActive <= 2 ? 90 : s.validatorsActive <= 5 ? 70 : s.validatorsActive <= 10 ? 40 : s.validatorsActive <= 15 ? 25 : 10;
  } else {
    valConcentration = s.minersActive <= 1 ? 75 : s.minersActive <= 5 ? 55 : s.minersActive <= 20 ? 35 : s.minersActive <= 50 ? 20 : 10;
  }
  score += 0.35 * valConcentration;
  const stakeConc = clamp(s.stakeConcentration, 0, 100);
  score += 0.25 * stakeConc;
  const activeCount = s.validatorsActive > 0 ? s.validatorsActive : s.minersActive;
  const emissionFactor = p.emissionShare > 5 && activeCount <= 5 ? 80 :
    p.emissionShare > 3 && activeCount <= 10 ? 60 :
    p.emissionShare > 1.5 ? 40 :
    p.emissionShare > 0.5 ? 25 : 10;
  score += 0.25 * emissionFactor;
  const lowActivity = s.minersActive <= 1 ? 80 : s.minersActive <= 5 ? 60 : s.minersActive <= 20 ? 40 : s.uidUsage < 0.1 ? 30 : 10;
  score += 0.15 * lowActivity;
  return clamp(Math.round(score), 0, 100);
}

/* ─── Alpha Fair Value (REFACTORED) ─── */
// New model: fair_alpha = market_cap / circulating_supply
export function computeFairAlphaPrice(_s: StakeSnapshot, p: PriceContext, eco?: EconomicContext): number {
  if (eco && eco.circulatingSupply > 0 && p.marketCap > 0) {
    return p.marketCap / eco.circulatingSupply;
  }
  return 0;
}

// Keep legacy for cross-subnet fallback
export function computeFundamentalsScore(s: StakeSnapshot, p: PriceContext): number {
  const minersScore = s.minersActive > 0 ? clamp(Math.log(s.minersActive + 1) / Math.log(257) * 100, 0, 100) : 0;
  const stakeScore = s.stakeTotal > 0 ? clamp(Math.log(s.stakeTotal + 1) / Math.log(1e7) * 100, 0, 100) : 0;
  const emissionScore = clamp(p.emissionShare * 10, 0, 100);
  const volScore = p.vol24h > 0 ? clamp(Math.log(p.vol24h + 1) / Math.log(1e5) * 100, 0, 100) : 0;
  const liqScore = p.marketCap > 0 ? clamp((p.vol24h / p.marketCap) * 1000, 0, 100) : 0;
  return 0.35 * minersScore + 0.25 * stakeScore + 0.20 * emissionScore + 0.10 * volScore + 0.10 * liqScore;
}

export function computeAlphaInefficiency(realPrice: number, fairPrice: number): number {
  if (fairPrice <= 0 || realPrice <= 0) return 0;
  return ((realPrice - fairPrice) / fairPrice) * 100;
}

export function computeRadarScores(
  s: StakeSnapshot, d: StakeDeltas, p: PriceContext,
  crossSubnet?: { medianPrice: number; medianFundamentals: number },
  eco?: EconomicContext, dm?: DerivedMetrics,
): RadarScores {
  // Fair alpha: prefer new model (mcap/circulating), fallback to cross-subnet
  let fairAlpha = computeFairAlphaPrice(s, p, eco);
  if (fairAlpha <= 0 && crossSubnet) {
    const fundamentals = computeFundamentalsScore(s, p);
    fairAlpha = crossSubnet.medianPrice > 0 && crossSubnet.medianFundamentals > 0
      ? crossSubnet.medianPrice * (fundamentals / crossSubnet.medianFundamentals)
      : 0;
  }
  return {
    healthIndex: computeHealthIndex(s, d),
    capitalMomentum: computeCapitalMomentum(s, d, p, eco, dm),
    dumpRisk: computeDumpRisk(s, d, p, eco, dm),
    subnetRadarScore: computeSubnetRadarScore(s, d, dm),
    narrativeScore: computeNarrativeScore(s, d, p),
    smartMoneyScore: computeSmartMoneyScore(s, d, p, eco),
    bubbleScore: computeBubbleScore(s, d, p),
    manipulationScore: computeManipulationScore(s, p),
    alphaInefficiency: computeAlphaInefficiency(p.currentPrice, fairAlpha),
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

/* ═══════════════════════════════════════ */
/*   AMM / PRICING EFFICIENCY              */
/* ═══════════════════════════════════════ */

export type AMMMetrics = {
  poolBalance: number;         // taoInPool / alphaInPool ratio
  slippageBps1Tao: number;     // estimated slippage in bps for 1 TAO trade
  slippageBps10Tao: number;    // estimated slippage in bps for 10 TAO trade
  spreadBps: number;           // estimated bid/ask spread in bps
  ammEfficiency: number;       // 0-100 composite score
  poolDepth: number;           // total pool value in TAO (taoInPool * 2 proxy)
};

/**
 * Estimate slippage for a constant-product AMM (x*y=k).
 * For buying alpha with `tradeTao` TAO:
 *   alphaOut = alphaInPool - k / (taoInPool + tradeTao)
 *   effectivePrice = tradeTao / alphaOut
 *   slippage = (effectivePrice - spotPrice) / spotPrice
 */
export function estimateSlippageBps(taoInPool: number, alphaInPool: number, tradeTao: number): number {
  if (taoInPool <= 0 || alphaInPool <= 0 || tradeTao <= 0) return 0;
  const k = taoInPool * alphaInPool;
  const alphaOut = alphaInPool - k / (taoInPool + tradeTao);
  if (alphaOut <= 0) return 10000; // 100% slippage
  const spotPrice = taoInPool / alphaInPool;
  const effectivePrice = tradeTao / alphaOut;
  return Math.round(((effectivePrice - spotPrice) / spotPrice) * 10000);
}

/**
 * Estimate bid/ask spread from pool depth.
 * Uses a 0.1 TAO reference trade to measure round-trip cost.
 */
export function estimateSpreadBps(taoInPool: number, alphaInPool: number): number {
  if (taoInPool <= 0 || alphaInPool <= 0) return 0;
  // Use fixed 0.1 TAO trade for spread estimation
  const tradeTao = 0.1;
  const buySlippage = estimateSlippageBps(taoInPool, alphaInPool, tradeTao);
  // Sell side: convert 0.1 TAO worth of alpha back
  const alphaEquiv = tradeTao * (alphaInPool / taoInPool);
  const sellSlippage = estimateSlippageBps(alphaInPool, taoInPool, alphaEquiv);
  return Math.max(1, buySlippage + sellSlippage); // minimum 1bp if pool exists
}

export function computeAMMMetrics(eco: EconomicContext): AMMMetrics {
  const { taoInPool, alphaInPool } = eco;
  const poolBalance = alphaInPool > 0 ? taoInPool / alphaInPool : 0;
  const slippageBps1Tao = estimateSlippageBps(taoInPool, alphaInPool, 1);
  const slippageBps10Tao = estimateSlippageBps(taoInPool, alphaInPool, 10);
  const spreadBps = estimateSpreadBps(taoInPool, alphaInPool);
  const poolDepth = taoInPool * 2; // proxy: total pool value ≈ 2x TAO side

  // AMM Efficiency score (0-100) — continuous scale for differentiation
  let efficiency = 0;

  // Pool depth component (0-35): log-scaled for better spread
  if (poolDepth > 0) {
    const depthLog = Math.log10(poolDepth + 1); // e.g. 10K→4, 100K→5, 1M→6
    efficiency += clamp(Math.round(depthLog * 7), 0, 35);
  }

  // Slippage component for 1 TAO (0-25): lower slippage = better
  if (slippageBps1Tao <= 0 && taoInPool > 0) efficiency += 25; // negligible
  else if (slippageBps1Tao <= 5) efficiency += 22;
  else if (slippageBps1Tao <= 10) efficiency += 18;
  else if (slippageBps1Tao <= 20) efficiency += 14;
  else if (slippageBps1Tao <= 50) efficiency += 8;
  else if (slippageBps1Tao <= 100) efficiency += 4;
  // >100bp: 0

  // Slippage for 10 TAO (0-20): tests deeper liquidity
  if (slippageBps10Tao <= 0 && taoInPool > 0) efficiency += 20;
  else if (slippageBps10Tao <= 10) efficiency += 18;
  else if (slippageBps10Tao <= 30) efficiency += 14;
  else if (slippageBps10Tao <= 50) efficiency += 10;
  else if (slippageBps10Tao <= 100) efficiency += 6;
  else if (slippageBps10Tao <= 200) efficiency += 3;

  // Spread component (0-10)
  if (spreadBps <= 2) efficiency += 10;
  else if (spreadBps <= 5) efficiency += 8;
  else if (spreadBps <= 10) efficiency += 6;
  else if (spreadBps <= 30) efficiency += 4;
  else if (spreadBps <= 100) efficiency += 2;

  // Pool balance component (0-10): ratio closer to spot = better
  if (poolBalance > 0) {
    const imbalance = Math.abs(Math.log(poolBalance));
    if (imbalance < 0.5) efficiency += 10;
    else if (imbalance < 1) efficiency += 7;
    else if (imbalance < 2) efficiency += 4;
    else if (imbalance < 3) efficiency += 2;
    // >3x imbalance: 0
  }

  return {
    poolBalance,
    slippageBps1Tao,
    slippageBps10Tao,
    spreadBps,
    ammEfficiency: clamp(Math.round(efficiency), 0, 100),
    poolDepth,
  };
}

export function ammEfficiencyColor(score: number): string {
  if (score >= 75) return "rgba(76,175,80,0.8)";
  if (score >= 50) return "rgba(255,193,7,0.8)";
  if (score >= 30) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

export function slippageColor(bps: number): string {
  if (bps <= 10) return "rgba(76,175,80,0.8)";
  if (bps <= 50) return "rgba(255,193,7,0.8)";
  if (bps <= 200) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.8)";
}
