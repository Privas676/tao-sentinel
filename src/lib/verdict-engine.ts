/* ═══════════════════════════════════════════════════════════ */
/*   VERDICT ENGINE v3 — FROM SCRATCH                         */
/*   4 PILLARS: Momentum, AMM, Risk, Data Quality             */
/*   RENTRE / HOLD / SORS with auditable rules                */
/*   Every rule is explicit, traceable, and visible in UI      */
/* ═══════════════════════════════════════════════════════════ */

import { clamp } from "./gauge-types";
import type {
  StakeSnapshot, StakeDeltas, PriceContext,
  EconomicContext, DerivedMetrics, AMMMetrics,
} from "./stake-analytics";
import { computeAMMMetrics } from "./stake-analytics";

/* ══════════════════════════════════════ */
/*  TYPES                                  */
/* ══════════════════════════════════════ */

export type Verdict = "RENTRE" | "HOLD" | "SORS";
export type ConfidenceLevel = "forte" | "moyenne" | "faible";
export type DataReliability = "stable" | "partial" | "suspect" | "stale";

export type VerdictReason = {
  label: string;
  positive: boolean;
  pillar: "momentum" | "amm" | "risk" | "data";
};

export type PillarScore = {
  score: number;      // 0-100
  weight: number;     // 0-1
  label: string;
  components: { name: string; value: number; max: number }[];
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
  allReasons: VerdictReason[];
  /** v3: per-pillar breakdown for full auditability */
  pillars: {
    momentum: PillarScore;
    amm: PillarScore;
    risk: PillarScore;
    dataQuality: PillarScore;
  };
  /** v3: data reliability status */
  dataReliability: DataReliability;
};

/* ══════════════════════════════════════ */
/*  INPUT                                  */
/* ══════════════════════════════════════ */

export type VerdictInput = {
  netuid: number;
  snapshot: StakeSnapshot;
  deltas: StakeDeltas;
  priceContext: PriceContext;
  economicContext: EconomicContext;
  derivedMetrics: DerivedMetrics;
  // Optional enrichment from unified scores
  radarScores?: any;         // kept for backward compat, NOT used in v3 verdict
  momentum?: number;
  stability?: number;
  dataConfidence?: number;   // 0-100
  isWhitelisted?: boolean;
  oldEngineRisk?: number;
  isOverridden?: boolean;
  systemStatus?: string;
};

/* ══════════════════════════════════════════════════════════ */
/*  PILLAR A — MOMENTUM / FLUX (weight: 0.30)                */
/*  What it measures: capital flow direction & price trend     */
/*  Sources: price changes, stake flow, buy/sell ratio         */
/* ══════════════════════════════════════════════════════════ */

function computeMomentumPillar(
  d: StakeDeltas, p: PriceContext, eco: EconomicContext,
): PillarScore {
  const components: PillarScore["components"] = [];

  // A1. Price trend 7d (0-25)
  let priceTrend = 0;
  if (p.priceChange7d > 15) priceTrend = 25;
  else if (p.priceChange7d > 5) priceTrend = 20;
  else if (p.priceChange7d > 0) priceTrend = 14;
  else if (p.priceChange7d > -5) priceTrend = 8;
  else if (p.priceChange7d > -15) priceTrend = 3;
  else priceTrend = 0;
  components.push({ name: "Prix 7j", value: priceTrend, max: 25 });

  // A2. Price trend 1d (short-term confirmation) (0-15)
  let priceShort = 0;
  if (p.priceChange1d > 5) priceShort = 15;
  else if (p.priceChange1d > 1) priceShort = 12;
  else if (p.priceChange1d > -2) priceShort = 8;
  else if (p.priceChange1d > -5) priceShort = 3;
  else priceShort = 0;
  components.push({ name: "Prix 1j", value: priceShort, max: 15 });

  // A3. Stake flow 7d (strongest signal) (0-30)
  let stakeFlow = 0;
  if (d.stakeChange7d > 0.15) stakeFlow = 30;
  else if (d.stakeChange7d > 0.05) stakeFlow = 24;
  else if (d.stakeChange7d > 0.01) stakeFlow = 16;
  else if (d.stakeChange7d > -0.02) stakeFlow = 8;
  else if (d.stakeChange7d > -0.10) stakeFlow = 2;
  else stakeFlow = 0;
  components.push({ name: "Stake flow 7j", value: stakeFlow, max: 30 });

  // A4. Buy/Sell ratio (observed sentiment) (0-20)
  let buySell = 0;
  if (eco.sentiment > 0.65) buySell = 20;
  else if (eco.sentiment > 0.55) buySell = 16;
  else if (eco.sentiment > 0.48) buySell = 10;
  else if (eco.sentiment > 0.40) buySell = 5;
  else buySell = 0;
  components.push({ name: "Buy/Sell", value: buySell, max: 20 });

  // A5. Volume activity (0-10)
  let volActivity = 0;
  const volMcap = eco.volumeMarketcapRatio;
  if (volMcap > 0.05) volActivity = 10;
  else if (volMcap > 0.01) volActivity = 7;
  else if (volMcap > 0.003) volActivity = 4;
  else volActivity = 0;
  components.push({ name: "Volume/MCap", value: volActivity, max: 10 });

  const score = clamp(priceTrend + priceShort + stakeFlow + buySell + volActivity, 0, 100);

  return { score, weight: 0.30, label: "Momentum / Flux", components };
}

/* ══════════════════════════════════════════════════════════ */
/*  PILLAR B — AMM / EXÉCUTION (weight: 0.25)                */
/*  What it measures: can you actually trade this?             */
/*  Sources: pool depth, slippage, spread, pool balance        */
/* ══════════════════════════════════════════════════════════ */

function computeAMMPillar(
  eco: EconomicContext, p: PriceContext, dm: DerivedMetrics,
): PillarScore {
  const components: PillarScore["components"] = [];
  const amm = computeAMMMetrics(eco);

  // B1. Pool depth (0-30) — log-scaled
  let depth = 0;
  if (amm.poolDepth > 100_000) depth = 30;
  else if (amm.poolDepth > 10_000) depth = 25;
  else if (amm.poolDepth > 1_000) depth = 18;
  else if (amm.poolDepth > 100) depth = 12;
  else if (amm.poolDepth > 10) depth = 5;
  else depth = 0;
  components.push({ name: "Profondeur pool", value: depth, max: 30 });

  // B2. Slippage 1τ (0-25) — lower is better
  let slip1 = 0;
  if (amm.slippageBps1Tao <= 0 && eco.taoInPool > 0) slip1 = 25;
  else if (amm.slippageBps1Tao <= 2) slip1 = 22;
  else if (amm.slippageBps1Tao <= 5) slip1 = 18;
  else if (amm.slippageBps1Tao <= 10) slip1 = 14;
  else if (amm.slippageBps1Tao <= 30) slip1 = 8;
  else if (amm.slippageBps1Tao <= 100) slip1 = 3;
  else slip1 = 0;
  components.push({ name: "Slippage 1τ", value: slip1, max: 25 });

  // B3. Spread bid/ask (0-20) — lower is better
  let spread = 0;
  if (amm.spreadBps <= 1) spread = 20;
  else if (amm.spreadBps <= 3) spread = 16;
  else if (amm.spreadBps <= 10) spread = 12;
  else if (amm.spreadBps <= 30) spread = 6;
  else if (amm.spreadBps <= 100) spread = 2;
  else spread = 0;
  components.push({ name: "Spread", value: spread, max: 20 });

  // B4. Pool balance — closer to 1.0 = healthier (0-15)
  // Widened healthy range: Bittensor pools are structurally alpha-heavy, 0.5-2.0 is normal
  let balance = 0;
  if (dm.poolBalance > 0.5 && dm.poolBalance < 2.0) balance = 15;
  else if (dm.poolBalance > 0.3 && dm.poolBalance < 3.0) balance = 10;
  else if (dm.poolBalance > 0.15 && dm.poolBalance < 5) balance = 5;
  else balance = 0;
  components.push({ name: "Pool balance", value: balance, max: 15 });

  // B5. Market cap (tradable size) (0-10)
  let mcap = 0;
  if (p.marketCap > 5000) mcap = 10;
  else if (p.marketCap > 1000) mcap = 8;
  else if (p.marketCap > 200) mcap = 5;
  else if (p.marketCap > 50) mcap = 2;
  else mcap = 0;
  components.push({ name: "Market cap", value: mcap, max: 10 });

  const score = clamp(depth + slip1 + spread + balance + mcap, 0, 100);

  return { score, weight: 0.25, label: "AMM / Exécution", components };
}

/* ══════════════════════════════════════════════════════════ */
/*  PILLAR C — RISK / STRUCTURE (weight: 0.30)                */
/*  What it measures: structural fragility & danger signals    */
/*  INVERTED: higher = MORE risk → we compute riskScore,       */
/*  then contribution = 100 - riskScore for the entry side     */
/* ══════════════════════════════════════════════════════════ */

function computeRiskPillar(
  s: StakeSnapshot, d: StakeDeltas, p: PriceContext,
  eco: EconomicContext, dm: DerivedMetrics,
): PillarScore {
  const components: PillarScore["components"] = [];

  // C1. Sell pressure (0-25) — higher = more risk
  let sellPressure = 0;
  const totalVol = eco.buyVolume + eco.sellVolume;
  if (totalVol > 0) {
    const sellRatio = eco.sellVolume / totalVol;
    if (sellRatio > 0.75) sellPressure = 25;
    else if (sellRatio > 0.60) sellPressure = 18;
    else if (sellRatio > 0.52) sellPressure = 10;
    else sellPressure = 3;
  } else {
    // No volume data — use price as fallback
    if (p.priceChange1d < -10) sellPressure = 22;
    else if (p.priceChange1d < -5) sellPressure = 14;
    else sellPressure = 5;
  }
  components.push({ name: "Pression vendeuse", value: sellPressure, max: 25 });

  // C2. Concentration risk (0-20) — Bittensor-calibrated
  let concentration = 0;
  const effConc = s.stakeConcentration <= 0 ? 80 : s.stakeConcentration;
  if (effConc > 98) concentration = 20;
  else if (effConc > 95) concentration = 14;
  else if (effConc > 85) concentration = 8;
  else concentration = 2;
  components.push({ name: "Concentration", value: concentration, max: 20 });

  // C3. Validator fragility (0-20)
  let valRisk = 0;
  if (s.validatorsActive <= 1) valRisk = 20;
  else if (s.validatorsActive <= 3) valRisk = 15;
  else if (s.validatorsActive <= 5) valRisk = 8;
  else if (s.validatorsActive <= 10) valRisk = 3;
  else valRisk = 0;
  components.push({ name: "Fragilité validators", value: valRisk, max: 20 });

  // C4. Liquidity risk (0-15)
  let liqRisk = 0;
  if (p.liquidity < 5) liqRisk = 15;
  else if (p.liquidity < 20) liqRisk = 12;
  else if (p.liquidity < 100) liqRisk = 7;
  else if (p.liquidity < 500) liqRisk = 2;
  else liqRisk = 0;
  components.push({ name: "Risque liquidité", value: liqRisk, max: 15 });

  // C5. UID saturation stagnation (0-10)
  // Growth neutralizes saturation risk: active demand proves the subnet isn't stagnant
  let satRisk = 0;
  if (dm.uidSaturation > 0.95 && d.minersGrowth7d <= 0) satRisk = 10;
  else if (dm.uidSaturation > 0.90 && d.minersGrowth7d <= 0) satRisk = 6;
  else if (dm.uidSaturation > 0.95 && d.minersGrowth7d > 0) satRisk = 0; // full but growing = healthy demand
  else satRisk = 0;
  components.push({ name: "Saturation UID", value: satRisk, max: 10 });

  // C6. Emissions / burn stress (0-10)
  let emitRisk = 0;
  if (dm.burnRatio < 0.01 && eco.emissionsPerDay > 50) emitRisk = 10; // heavy emissions, no burn
  else if (dm.burnRatio < 0.1 && eco.emissionsPerDay > 100) emitRisk = 6;
  else if (eco.emissionsPerDay < 1) emitRisk = 3; // too low, dying
  else emitRisk = 0;
  components.push({ name: "Stress émissions/burn", value: emitRisk, max: 10 });

  // Total risk score (0-100, higher = riskier)
  const riskScore = clamp(sellPressure + concentration + valRisk + liqRisk + satRisk + emitRisk, 0, 100);

  return { score: riskScore, weight: 0.30, label: "Risque / Structure", components };
}

/* ══════════════════════════════════════════════════════════ */
/*  PILLAR D — DATA QUALITY (weight: 0.15)                    */
/*  What it measures: can we trust the data?                   */
/*  Sources: freshness, completeness, consistency              */
/* ══════════════════════════════════════════════════════════ */

function computeDataQualityPillar(
  p: PriceContext, eco: EconomicContext, s: StakeSnapshot,
  dataConfidence?: number,
): PillarScore {
  const components: PillarScore["components"] = [];

  // D1. External data confidence if available (0-30)
  let confScore = 15; // default neutral
  if (dataConfidence != null) {
    confScore = clamp(Math.round(dataConfidence * 0.3), 0, 30);
  }
  components.push({ name: "Confiance API", value: confScore, max: 30 });

  // D2. Price data available & non-zero (0-20)
  let priceData = 0;
  if (p.currentPrice > 0 && p.marketCap > 0) priceData = 20;
  else if (p.currentPrice > 0) priceData = 12;
  else priceData = 0;
  components.push({ name: "Données prix", value: priceData, max: 20 });

  // D3. Volume & liquidity data present (0-20)
  let volumeData = 0;
  if (p.vol24h > 0 && p.liquidity > 0) volumeData = 20;
  else if (p.vol24h > 0 || p.liquidity > 0) volumeData = 10;
  else volumeData = 0;
  components.push({ name: "Données volume/liq", value: volumeData, max: 20 });

  // D4. Economic data completeness (0-15)
  let ecoData = 0;
  let ecoFieldsPresent = 0;
  if (eco.emissionsPerDay > 0) ecoFieldsPresent++;
  if (eco.buyVolume > 0 || eco.sellVolume > 0) ecoFieldsPresent++;
  if (eco.taoInPool > 0) ecoFieldsPresent++;
  if (eco.circulatingSupply > 0) ecoFieldsPresent++;
  if (eco.buyersCount > 0 || eco.sellersCount > 0) ecoFieldsPresent++;
  ecoData = clamp(Math.round((ecoFieldsPresent / 5) * 15), 0, 15);
  components.push({ name: "Données économiques", value: ecoData, max: 15 });

  // D5. Structural data (validators/miners known) (0-15)
  let structData = 0;
  if (s.validatorsActive > 0 && s.minersActive > 0) structData = 15;
  else if (s.validatorsActive > 0 || s.minersActive > 0) structData = 8;
  else structData = 0;
  components.push({ name: "Données structure", value: structData, max: 15 });

  const score = clamp(confScore + priceData + volumeData + ecoData + structData, 0, 100);

  return { score, weight: 0.15, label: "Qualité données", components };
}

/* ══════════════════════════════════════════════════════════ */
/*  DATA RELIABILITY CLASSIFICATION                           */
/* ══════════════════════════════════════════════════════════ */

function classifyDataReliability(dq: PillarScore, dataConfidence?: number): DataReliability {
  if (dataConfidence != null && dataConfidence < 20) return "stale";
  if (dq.score < 30) return "suspect";
  if (dq.score < 55) return "partial";
  return "stable";
}

/* ══════════════════════════════════════════════════════════ */
/*  COMPOSITE SCORES                                          */
/*  entryScore: how attractive is entering?                    */
/*  holdScore:  how safe is holding?                           */
/*  exitRisk:   how dangerous is staying?                      */
/* ══════════════════════════════════════════════════════════ */

export function computeEntryScore(input: VerdictInput): number {
  const mom = computeMomentumPillar(input.deltas, input.priceContext, input.economicContext);
  const amm = computeAMMPillar(input.economicContext, input.priceContext, input.derivedMetrics);
  const risk = computeRiskPillar(input.snapshot, input.deltas, input.priceContext, input.economicContext, input.derivedMetrics);
  const dq = computeDataQualityPillar(input.priceContext, input.economicContext, input.snapshot, input.dataConfidence);

  // Entry = momentum + AMM quality - risk + data quality bonus
  return clamp(Math.round(
    mom.score * 0.35 +
    amm.score * 0.30 +
    (100 - risk.score) * 0.25 +  // invert: low risk = good for entry
    dq.score * 0.10
  ), 0, 100);
}

export function computeHoldScore(input: VerdictInput): number {
  const mom = computeMomentumPillar(input.deltas, input.priceContext, input.economicContext);
  const amm = computeAMMPillar(input.economicContext, input.priceContext, input.derivedMetrics);
  const risk = computeRiskPillar(input.snapshot, input.deltas, input.priceContext, input.economicContext, input.derivedMetrics);

  // Hold = moderate momentum ok + decent AMM + low risk
  return clamp(Math.round(
    mom.score * 0.25 +
    amm.score * 0.30 +
    (100 - risk.score) * 0.45   // risk is the main driver for hold decisions
  ), 0, 100);
}

export function computeExitRisk(input: VerdictInput): number {
  const risk = computeRiskPillar(input.snapshot, input.deltas, input.priceContext, input.economicContext, input.derivedMetrics);
  return risk.score; // direct: higher = more dangerous
}

/* ══════════════════════════════════════════════════════════ */
/*  CONFIDENCE — based on signal alignment + data quality      */
/* ══════════════════════════════════════════════════════════ */

function computeConfidence(
  mom: PillarScore, amm: PillarScore, risk: PillarScore, dq: PillarScore,
  reliability: DataReliability,
): ConfidenceLevel {
  // If data is unreliable, confidence is always faible
  if (reliability === "stale" || reliability === "suspect") return "faible";

  // Count strong signals (pillars with clear direction)
  let aligned = 0;
  if (mom.score > 60 || mom.score < 25) aligned++;     // clear momentum direction
  if (amm.score > 60) aligned++;                         // clearly tradable
  if (risk.score > 55 || risk.score < 25) aligned++;     // clear risk signal
  if (dq.score > 60) aligned++;                           // good data

  if (aligned >= 3) return "forte";
  if (aligned >= 2) return "moyenne";
  return "faible";
}

/* ══════════════════════════════════════════════════════════ */
/*  REASONS — auditable, traceable, max 3 per polarity        */
/* ══════════════════════════════════════════════════════════ */

function collectReasons(input: VerdictInput): VerdictReason[] {
  const reasons: VerdictReason[] = [];
  const { snapshot: s, deltas: d, priceContext: p, economicContext: eco, derivedMetrics: dm } = input;
  const amm = computeAMMMetrics(eco);

  // ── Momentum reasons ──
  if (d.stakeChange7d > 0.05)
    reasons.push({ label: "Flux de stake en hausse 7j", positive: true, pillar: "momentum" });
  else if (d.stakeChange7d < -0.05)
    reasons.push({ label: "Flux de stake en baisse 7j", positive: false, pillar: "momentum" });

  if (p.priceChange7d > 10)
    reasons.push({ label: "Momentum prix positif (+"+Math.round(p.priceChange7d)+"%)", positive: true, pillar: "momentum" });
  else if (p.priceChange7d < -15)
    reasons.push({ label: "Chute prix 7j ("+Math.round(p.priceChange7d)+"%)", positive: false, pillar: "momentum" });

  if (eco.sentiment > 0.60)
    reasons.push({ label: "Pression acheteuse dominante", positive: true, pillar: "momentum" });
  else if (eco.sentiment < 0.38)
    reasons.push({ label: "Pression vendeuse élevée", positive: false, pillar: "momentum" });

  // ── AMM reasons ──
  if (amm.poolDepth > 10_000)
    reasons.push({ label: "Profondeur pool solide ("+Math.round(amm.poolDepth)+"τ)", positive: true, pillar: "amm" });
  else if (amm.poolDepth < 50 && amm.poolDepth > 0)
    reasons.push({ label: "Pool très faible ("+Math.round(amm.poolDepth)+"τ)", positive: false, pillar: "amm" });

  if (amm.slippageBps1Tao <= 5 && eco.taoInPool > 0)
    reasons.push({ label: "Slippage négligeable", positive: true, pillar: "amm" });
  else if (amm.slippageBps1Tao > 50)
    reasons.push({ label: "Slippage élevé ("+amm.slippageBps1Tao+"bp)", positive: false, pillar: "amm" });

  if (dm.poolBalance < 0.3 && dm.poolBalance > 0)
    reasons.push({ label: "Déséquilibre pool critique", positive: false, pillar: "amm" });

  // ── Risk reasons ──
  if (s.validatorsActive >= 15)
    reasons.push({ label: "Structure validators saine ("+s.validatorsActive+")", positive: true, pillar: "risk" });
  else if (s.validatorsActive <= 2)
    reasons.push({ label: "Très peu de validators ("+s.validatorsActive+")", positive: false, pillar: "risk" });

  if (s.minersActive >= 50 && d.minersGrowth7d > 0)
    reasons.push({ label: "Adoption mineurs en croissance", positive: true, pillar: "risk" });
  else if (s.minersActive < 5)
    reasons.push({ label: "Très peu de mineurs ("+s.minersActive+")", positive: false, pillar: "risk" });

  const effConc = s.stakeConcentration <= 0 ? 80 : s.stakeConcentration;
  if (effConc > 98)
    reasons.push({ label: "Concentration stake extrême ("+Math.round(effConc)+"%)", positive: false, pillar: "risk" });
  else if (effConc < 85)
    reasons.push({ label: "Stake relativement distribué", positive: true, pillar: "risk" });

  if (p.liquidity > 500)
    reasons.push({ label: "Liquidité correcte", positive: true, pillar: "risk" });
  else if (p.liquidity < 20)
    reasons.push({ label: "Sous-liquidité critique ("+Math.round(p.liquidity)+"τ)", positive: false, pillar: "risk" });

  if (dm.uidSaturation > 0.95 && d.minersGrowth7d <= 0)
    reasons.push({ label: "UID saturé sans croissance", positive: false, pillar: "risk" });

  if (dm.burnRatio < 0.01 && eco.emissionsPerDay > 50)
    reasons.push({ label: "Emissions élevées sans burn", positive: false, pillar: "risk" });

  // ── Data reasons ──
  if (p.currentPrice <= 0 || p.marketCap <= 0)
    reasons.push({ label: "Données prix manquantes", positive: false, pillar: "data" });

  if (eco.taoInPool <= 0 && eco.alphaInPool <= 0)
    reasons.push({ label: "Données pool indisponibles", positive: false, pillar: "data" });

  return reasons;
}

/* ══════════════════════════════════════════════════════════ */
/*  MAIN VERDICT — explicit rules, no opaque scoring          */
/* ══════════════════════════════════════════════════════════ */

export function computeVerdict(input: VerdictInput): VerdictResult {
  // ── Whitelisted subnets (e.g. ROOT) → forced HOLD ──
  if (input.isWhitelisted) {
    const neutralPillar: PillarScore = { score: 50, weight: 0.25, label: "N/A", components: [] };
    return {
      netuid: input.netuid,
      verdict: "HOLD",
      confidence: "forte",
      entryScore: 50,
      holdScore: 80,
      exitRisk: 10,
      positiveReasons: ["Subnet système (réseau principal)"],
      negativeReasons: [],
      allReasons: [{ label: "Subnet système (réseau principal)", positive: true, pillar: "risk" }],
      pillars: { momentum: neutralPillar, amm: neutralPillar, risk: { ...neutralPillar, score: 10 }, dataQuality: { ...neutralPillar, score: 80 } },
      dataReliability: "stable",
    };
  }

  // ── Compute all 4 pillars ──
  const momentum = computeMomentumPillar(input.deltas, input.priceContext, input.economicContext);
  const amm = computeAMMPillar(input.economicContext, input.priceContext, input.derivedMetrics);
  const risk = computeRiskPillar(input.snapshot, input.deltas, input.priceContext, input.economicContext, input.derivedMetrics);
  const dataQuality = computeDataQualityPillar(input.priceContext, input.economicContext, input.snapshot, input.dataConfidence);
  const dataReliability = classifyDataReliability(dataQuality, input.dataConfidence);

  // ── Composite scores ──
  const entryScore = clamp(Math.round(
    momentum.score * 0.35 +
    amm.score * 0.30 +
    (100 - risk.score) * 0.25 +
    dataQuality.score * 0.10
  ), 0, 100);

  const holdScore = clamp(Math.round(
    momentum.score * 0.25 +
    amm.score * 0.30 +
    (100 - risk.score) * 0.45
  ), 0, 100);

  const exitRisk = risk.score;

  const confidence = computeConfidence(momentum, amm, risk, dataQuality, dataReliability);
  const allReasons = collectReasons(input);

  // ══════════════════════════════════════
  //  VERDICT DECISION — explicit rules
  // ══════════════════════════════════════

  let verdict: Verdict;

  // Momentum-adjusted exit threshold:
  // Strong momentum (>60) raises the bar for triggering SORS — capital inflow
  // signals the market disagrees with structural risk alone.
  // Base threshold: 55. With momentum 80 → 55 + 10 = 65.
  const momentumDampening = momentum.score > 60 ? Math.round((momentum.score - 60) * 0.25) : 0;
  const effectiveExitThreshold = 55 + momentumDampening; // max ~65 at momentum=100

  // Rule 1: Insufficient data → prudent HOLD
  if (dataReliability === "stale" || dataReliability === "suspect") {
    verdict = "HOLD"; // prudent, will show "données insuffisantes" in UI
  }
  // Rule 2: High risk → SORS (momentum-dampened)
  else if (exitRisk >= effectiveExitThreshold) {
    verdict = "SORS";
  }
  // Rule 3: Strong entry conditions → RENTRE
  else if (entryScore >= 55 && exitRisk < 40 && momentum.score >= 40 && amm.score >= 30) {
    verdict = "RENTRE";
  }
  // Rule 4: Decent hold conditions → HOLD
  else if (holdScore >= 45 && exitRisk < 55) {
    verdict = "HOLD";
  }
  // Rule 5: Conflict → prudent HOLD
  else {
    verdict = "HOLD";
  }

  // ══════════════════════════════════════
  //  SAFETY GUARDS — explicit, auditable
  // ══════════════════════════════════════

  // G1: Very few validators → block RENTRE
  if (input.snapshot.validatorsActive <= 2 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // G2: UID saturated + no growth → block RENTRE
  // Exception: strong momentum (>55) overrides — the subnet is attracting capital despite saturation
  if (input.derivedMetrics.uidSaturation > 0.95 && input.deltas.minersGrowth7d <= 0 && verdict === "RENTRE") {
    if (momentum.score <= 55) {
      verdict = "HOLD";
    }
  }

  // G3: High sell pressure + low liquidity → force SORS
  if (input.economicContext.sentiment < 0.35 && input.priceContext.liquidity < 30 && verdict !== "SORS") {
    verdict = "SORS";
  }

  // G4: Strong capital flow but validator risk → cap at HOLD
  if (entryScore > 60 && input.snapshot.validatorsActive <= 3 && verdict === "RENTRE") {
    verdict = "HOLD";
  }

  // G5: Extreme concentration + significant emissions → block RENTRE
  if (input.economicContext.emissionsPercent > 2 && (input.snapshot.stakeConcentration > 98 || (input.snapshot.stakeConcentration <= 0 && true)) && verdict === "RENTRE") {
    // Only apply if concentration is truly extreme (>98) — stakeConcentration=0 means unknown, don't penalize
    if (input.snapshot.stakeConcentration > 98) verdict = "HOLD";
  }

  // G6: Override/Depeg from protection engine → force SORS
  if (input.isOverridden) verdict = "SORS";
  if (input.systemStatus === "DEPEG") verdict = "SORS";

  // G7: Old engine high risk cross-check (transitional safety net)
  // Exception: strong momentum (>60) overrides — the old engine may not account for recent capital inflow
  if (input.oldEngineRisk != null && input.oldEngineRisk >= 70 && verdict !== "SORS") {
    if (momentum.score <= 60) verdict = "SORS";
  }

  // ── Slice top 3 reasons per polarity ──
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
    pillars: { momentum, amm, risk, dataQuality },
    dataReliability,
  };
}

/* ── Batch ── */

export function computeAllVerdicts(inputs: VerdictInput[]): VerdictResult[] {
  return inputs.map(computeVerdict);
}
