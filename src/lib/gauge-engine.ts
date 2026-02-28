/* ═══════════════════════════════════════ */
/*     ALIEN GAUGE — OPPORTUNITY/RISK ENGINE */
/*     v2: ANTI-100 + CONSENSUS DATA        */
/* ═══════════════════════════════════════ */
import { evaluateRiskOverride, capOpportunity } from "./risk-override";
import { calibrateScores } from "./risk-calibration";

export type GaugeState = "CALM" | "ALERT" | "IMMINENT" | "EXIT";
export type GaugePhase = "BUILD" | "ARMED" | "TRIGGER" | "NONE";
export type Asymmetry = "HIGH" | "MED" | "LOW";
export type MomentumLabel = "FORT" | "MODÉRÉ" | "STABLE" | "DÉTÉRIORATION";

export type SubnetSignal = {
  netuid: number;
  name: string;
  psi: number;
  opportunity: number;
  risk: number;
  confidence: number;
  state: GaugeState;
  phase: GaugePhase;
  asymmetry: Asymmetry;
  sparkline_7d: number[];
  liquidity: number;
  momentum: number;
  momentumLabel: MomentumLabel;
  momentumScore: number;
  reasons: string[];
  dominant: "opportunity" | "risk" | "neutral";
  isMicroCap: boolean;
  asMicro: number;
  preHype: boolean;
  preHypeIntensity: number;
  stabilitySetup: number;
  isOverridden: boolean;
  systemStatus: import("./risk-override").SystemStatus;
  overrideReasons: string[];
  dataUncertain: boolean;
  confianceData: number;
};

export type RawSignal = {
  netuid: number | null;
  subnet_name: string | null;
  state: string | null;
  score: number | null;
  mpi: number | null;
  confidence_pct: number | null;
  quality_score: number | null;
  reasons: any;
  miner_filter: string | null;
  ts: string | null;
};

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ═══════════════════════════════════════ */
/*   PERCENTILE + SIGMOID NORMALIZATION     */
/*   Section 2: Anti-100                    */
/* ═══════════════════════════════════════ */

function sigmoid(x: number, steepness = 10, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

function percentileRank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    const equal = sorted.filter(s => s === v).length;
    return ((below + equal * 0.5) / sorted.length) * 100;
  });
}

function applySCurve(percentile: number, steepness = 3): number {
  const normalized = percentile / 100;
  const curved = sigmoid(normalized, steepness, 0.5);
  const min = sigmoid(0, steepness, 0.5);
  const max = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - min) / (max - min)) * 100);
}

/** Normalize scores using percentile + mild S-curve, enforcing anti-100 rule (Section 2.2) */
export function normalizeWithVariance(rawScores: number[], steepness = 3): number[] {
  const ranks = percentileRank(rawScores);
  const normalized = ranks.map(r => applySCurve(r, steepness));

  // Anti-100: only allow 100 if unique strict max (Section 2.2)
  const maxRaw = Math.max(...rawScores);
  const maxCount = rawScores.filter(v => v === maxRaw).length;
  const uniqueMax = maxCount === 1;

  return normalized.map((score, i) => {
    if (score >= 100) {
      // Only the single unique maximum gets 100, all others capped at 99
      if (uniqueMax && rawScores[i] === maxRaw) return 100;
      return 99;
    }
    return score;
  });
}

/**
 * Percentile-to-score mapping for Opportunity scores.
 * Maps percentile ranks to target scores using linear interpolation
 * between anchor points, producing a realistic spread (median ≈ 65).
 * 
 * Anchor points: p10→35, p25→50, p50→65, p75→78, p90→88, p97→94, p99→97
 */
const OPP_ANCHORS: [number, number][] = [
  [0, 20], [10, 35], [25, 50], [50, 65], [75, 78], [90, 88], [97, 94], [99, 97], [100, 99],
];

function percentileToOppScore(pctile: number): number {
  if (pctile <= OPP_ANCHORS[0][0]) return OPP_ANCHORS[0][1];
  for (let j = 1; j < OPP_ANCHORS.length; j++) {
    const [p0, s0] = OPP_ANCHORS[j - 1];
    const [p1, s1] = OPP_ANCHORS[j];
    if (pctile <= p1) {
      const t = (pctile - p0) / (p1 - p0);
      return Math.round(s0 + t * (s1 - s0));
    }
  }
  return OPP_ANCHORS[OPP_ANCHORS.length - 1][1];
}

/** Normalize Opportunity scores using percentile mapping with anchor points */
export function normalizeOpportunity(rawScores: number[]): number[] {
  const ranks = percentileRank(rawScores);
  const mapped = ranks.map(r => percentileToOppScore(r));

  // Anti-100: only unique strict max gets 99 (never 100 for opportunity)
  const maxRaw = Math.max(...rawScores);
  const maxCount = rawScores.filter(v => v === maxRaw).length;

  const result = mapped.map((score, i) => {
    if (score > 97) {
      if (maxCount === 1 && rawScores[i] === maxRaw) return 98;
      return 97;
    }
    return score;
  });

  // Distribution audit log
  if (result.length >= 5) {
    const sorted = [...result].sort((a, b) => a - b);
    const p = (f: number) => sorted[Math.floor(f * (sorted.length - 1))];
    console.log(`[OPP-DIST] n=${result.length} min=${sorted[0]} p25=${p(0.25)} median=${p(0.5)} p75=${p(0.75)} max=${sorted[sorted.length - 1]}`);
  }

  return result;
}

/* PSI thresholds */
export const PSI_THRESHOLDS = {
  BUILD_MIN: 35,
  ARMED_MIN: 55,
  TRIGGER_MIN: 70,
  IMMINENT_MIN: 85,
  IMMINENT_CONFIDENCE: 70,
};

export function deriveGaugeState(psi: number, confidence: number, riskHigh = false): GaugeState {
  if (riskHigh) return "EXIT";
  if (psi >= PSI_THRESHOLDS.IMMINENT_MIN && confidence >= PSI_THRESHOLDS.IMMINENT_CONFIDENCE) return "IMMINENT";
  if (psi >= PSI_THRESHOLDS.BUILD_MIN) return "ALERT";
  return "CALM";
}

export function derivePhase(psi: number): GaugePhase {
  if (psi >= PSI_THRESHOLDS.TRIGGER_MIN) return "TRIGGER";
  if (psi >= PSI_THRESHOLDS.ARMED_MIN) return "ARMED";
  if (psi >= PSI_THRESHOLDS.BUILD_MIN) return "BUILD";
  return "NONE";
}

/* ═══════════════════════════════════════ */
/*   MOMENTUM (Section 6)                   */
/* ═══════════════════════════════════════ */

/** Compute momentum score (0-100) from PSI + price variation + volume/MC */
export function computeMomentumScore(psi: number, prevPsi?: number): number {
  const base = clamp(psi, 0, 100);
  const delta = prevPsi != null ? psi - prevPsi : 0;
  const accel = clamp(delta * 2, -20, 20);
  return clamp(Math.round(base * 0.7 + 50 * 0.1 + accel + 10), 0, 100);
}

/**
 * Compute momentum score V2 — multi-factor, designed for percentile ranking.
 * Uses: PSI (signal strength), price change 7d, volume/MC ratio.
 * Returns a raw score (not clamped to 0-100) to maximize distribution spread.
 */
export function computeMomentumScoreV2(
  psi: number,
  priceChange7d: number | null,
  volMcRatio: number | null,
): number {
  // PSI component: 40% weight, S-curve centered at 50
  const psiNorm = clamp((psi - 30) / 50, 0, 1); // maps 30-80 → 0-1
  const psiScore = psiNorm * 40;

  // Price change 7d component: 35% weight
  // Typical range: -30% to +50%, map to 0-35
  const pc = priceChange7d ?? 0;
  const pcNorm = clamp((pc + 15) / 50, 0, 1); // maps -15%→0, +35%→1
  const pcScore = pcNorm * 35;

  // Volume/MC ratio component: 25% weight
  // Healthy: 1-10%, map to 0-25
  const vm = volMcRatio ?? 0;
  const vmNorm = clamp(vm / 0.08, 0, 1); // 0-8% maps to 0-1
  const vmScore = vmNorm * 25;

  return psiScore + pcScore + vmScore;
}

/**
 * Assign momentum labels using PERCENTILE RANKING across the fleet.
 * Buckets: top 20% = FORT, next 40% = MODÉRÉ, next 30% = STABLE, bottom 10% = DÉTÉRIORATION.
 * Critical subnets are capped at STABLE.
 */
export function assignMomentumLabels(
  rows: { momentumScoreV2: number; isCritical: boolean }[]
): MomentumLabel[] {
  if (rows.length === 0) return [];

  // Sort indices by score descending to get percentile ranks
  const indexed = rows.map((r, i) => ({ i, score: r.momentumScoreV2 }));
  indexed.sort((a, b) => b.score - a.score);

  const labels: MomentumLabel[] = new Array(rows.length);
  const n = rows.length;

  for (let rank = 0; rank < indexed.length; rank++) {
    const { i } = indexed[rank];
    const pct = rank / n; // 0 = top, 1 = bottom

    let label: MomentumLabel;
    if (pct < 0.20) label = "FORT";
    else if (pct < 0.60) label = "MODÉRÉ";
    else if (pct < 0.90) label = "STABLE";
    else label = "DÉTÉRIORATION";

    // Critical subnets cannot be FORT
    if (rows[i].isCritical && (label === "FORT" || label === "MODÉRÉ")) {
      label = "STABLE";
    }

    labels[i] = label;
  }

  return labels;
}

/** @deprecated Use computeMomentumScoreV2 + assignMomentumLabels instead */
export function deriveMomentumLabel(psi: number, prevPsi?: number): MomentumLabel {
  const score = computeMomentumScore(psi, prevPsi);
  if (score >= 70) return "FORT";
  if (score >= 55) return "MODÉRÉ";
  if (score >= 40) return "STABLE";
  return "DÉTÉRIORATION";
}

export function momentumColor(label: MomentumLabel): string {
  switch (label) {
    case "FORT": return "rgba(76,175,80,0.85)";
    case "MODÉRÉ": return "rgba(255,193,7,0.8)";
    case "STABLE": return "rgba(255,255,255,0.4)";
    case "DÉTÉRIORATION": return "rgba(229,57,53,0.8)";
  }
}

/* ═══════════════════════════════════════ */
/*   STABILITÉ SETUP (Section 5)            */
/* ═══════════════════════════════════════ */

export function computeStabilitySetup(
  opportunity: number,
  risk: number,
  confidence: number,
  momentum: number,
  quality: number,
  dataUncertain = false
): number {
  // Stability from asymmetry variance proxy
  const asymStability = clamp(100 - Math.abs(opportunity - risk) * 0.3, 0, 40);
  // Confidence stability
  const confStability = clamp(confidence * 0.3, 0, 30);
  // Momentum stability (mid-range = more stable)
  const momentumStability = momentum >= 35 && momentum <= 75 ? 20 : clamp(20 - Math.abs(momentum - 55) * 0.4, 0, 20);
  // Quality bonus
  const qualityBonus = clamp(quality * 0.1, 0, 10);

  let result = Math.round(clamp(asymStability + confStability + momentumStability + qualityBonus, 0, 100));

  // DATA_UNCERTAIN penalty (Section 5)
  if (dataUncertain) {
    result = Math.max(0, result - 10);
  }

  return result;
}

export function stabilityColor(pct: number): string {
  if (pct >= 75) return "rgba(76,175,80,0.85)";
  if (pct >= 50) return "rgba(255,193,7,0.8)";
  if (pct >= 30) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

/* ═══════════════════════════════════════ */
/*   OPPORTUNITY / RISK ENGINE (v2 HEALTH)  */
/* ═══════════════════════════════════════ */

/** Legacy deriveOpportunity — kept for processSignals pipeline when no health data */
function deriveOpportunity(psi: number, conf: number, quality: number, state: string | null): number {
  let opp = 0;
  opp += psi * 0.30;
  opp += quality * 0.20;
  opp += conf * 0.15;
  if (state === "GO") opp += 12;
  else if (state === "GO_SPECULATIVE" || state === "EARLY") opp += 6;
  else if (state === "WATCH") opp += 2;
  else if (state === "HOLD") opp -= 3;
  if (state === "BREAK" || state === "EXIT_FAST") opp -= 25;
  if (psi < 30) opp -= 8;
  return Math.round(clamp(opp, 0, 100));
}

export type MarketRiskData = {
  volCap: number;
  topMinersShare: number;
  priceVol7d: number;
  liqRatio: number;
};

/** Legacy deriveRisk — kept for processSignals pipeline when no health data */
function deriveRisk(psi: number, conf: number, quality: number, state: string | null, market?: MarketRiskData): number {
  let risk = 20;
  risk += (100 - quality) * 0.25;
  risk += (100 - conf) * 0.20;
  risk += (100 - psi) * 0.10;

  if (market) {
    const vc = market.volCap;
    const vcIdeal = 0.08;
    const vcDist = Math.abs(Math.log((vc + 0.001) / vcIdeal));
    risk += clamp(vcDist * 8, 0, 15);
    risk += clamp(market.topMinersShare * 12, 0, 10);
    const lrScore = clamp(1 - market.liqRatio * 5, 0, 1);
    risk += lrScore * 10;
    risk += clamp(market.priceVol7d * 20, 0, 10);
  } else {
    risk += 15;
  }

  if (psi >= 70 && quality < 60) risk += 5;
  if (psi >= 80 && quality < 50) risk += 8;
  if (psi >= 85) risk += 3;
  if (psi < 40) risk += 5;
  if (conf < 50) risk += 4;
  if (conf < 30) risk += 4;
  if (state === "BREAK" || state === "EXIT_FAST") risk += 15;
  else if (state === "HOLD") risk += 3;
  else if (state === "WATCH") risk += 2;
  if (psi >= 40 && psi <= 60 && conf < 40) risk += 3;
  return Math.round(clamp(risk, 0, 100));
}

/** Apply DATA_UNCERTAIN penalty to risk (Section 3.2: 10% binary) */
function applyDataUncertaintyToRisk(risk: number, dataUncertain: boolean): number {
  if (dataUncertain) return clamp(risk + 10, 0, 100);
  return risk;
}

function deriveReasons(
  psi: number, conf: number, quality: number,
  state: string | null, dataUncertain: boolean, lang: "fr" | "en" = "fr"
): string[] {
  const reasons: string[] = [];
  const fr = lang === "fr";
  if (psi >= 70) reasons.push(fr ? "Momentum fort ↑" : "Strong momentum ↑");
  else if (psi >= 45) reasons.push(fr ? "Momentum modéré →" : "Moderate momentum →");
  if (conf >= 75) reasons.push(fr ? "Consensus élevé ✓" : "High consensus ✓");
  else if (conf < 40) reasons.push(fr ? "Consensus faible ⚠" : "Low consensus ⚠");
  if (quality >= 70) reasons.push(fr ? "Adoption réelle détectée" : "Real adoption detected");
  else if (quality < 30) reasons.push(fr ? "Hype > Adoption" : "Hype > Adoption");
  if (state === "BREAK" || state === "EXIT_FAST") reasons.unshift(fr ? "Signal de rupture ⛔" : "Break signal ⛔");
  if (state === "GO") reasons.push(fr ? "Signal d'entrée actif" : "Active entry signal");
  if (state === "GO_SPECULATIVE") reasons.push(fr ? "Spéculatif · cap faible" : "Speculative · low cap");
  if (dataUncertain) reasons.push(fr ? "Data incertaine ⚠" : "Uncertain data ⚠");
  return reasons.slice(0, 4);
}

/* Colors */
export function stateColor(state: GaugeState): string {
  switch (state) {
    case "IMMINENT": return "#e53935";
    case "EXIT": return "#ff6d00";
    case "ALERT": return "#fbc02d";
    case "CALM": return "#546e7a";
  }
}

export function stateGlow(state: GaugeState): string {
  switch (state) {
    case "IMMINENT": return "rgba(229,57,53,0.3)";
    case "EXIT": return "rgba(255,109,0,0.2)";
    case "ALERT": return "rgba(251,192,45,0.1)";
    case "CALM": return "rgba(84,110,122,0.05)";
  }
}

export function rayColor(state: GaugeState, alpha = 0.6): string {
  switch (state) {
    case "IMMINENT": return `rgba(229,57,53,${alpha})`;
    case "EXIT": return `rgba(255,109,0,${alpha})`;
    case "ALERT": return `rgba(251,192,45,${alpha})`;
    case "CALM": return `rgba(84,110,122,${alpha * 0.5})`;
  }
}

export function opportunityColor(score: number, alpha = 1): string {
  if (score >= 75) return `rgba(255,215,0,${alpha})`;
  if (score >= 50) return `rgba(251,192,45,${alpha})`;
  if (score >= 25) return `rgba(200,170,80,${alpha})`;
  return `rgba(140,130,90,${alpha * 0.6})`;
}

export function riskColor(score: number, alpha = 1): string {
  if (score >= 75) return `rgba(229,57,53,${alpha})`;
  if (score >= 50) return `rgba(255,109,0,${alpha})`;
  if (score >= 25) return `rgba(200,120,60,${alpha})`;
  return `rgba(100,90,80,${alpha * 0.5})`;
}

/* ═══════════════════════════════════════ */
/*   MICRO-CAP + PRE-HYPE ENGINE            */
/* ═══════════════════════════════════════ */

export function classifyMicroCaps(signals: SubnetSignal[]): void {
  const sorted = [...signals].sort((a, b) => (a.confidence + a.psi) - (b.confidence + b.psi));
  const cutoff = Math.ceil(sorted.length * 0.4);
  const microNetuids = new Set(sorted.slice(0, cutoff).map(s => s.netuid));
  for (const s of signals) {
    s.isMicroCap = microNetuids.has(s.netuid);
  }
}

export function computeASMicro(
  signal: SubnetSignal,
  smartCapitalState: string,
  flowDominance: "up" | "down" | "stable",
  flowEmission: "up" | "down" | "stable"
): number {
  const asStandard = signal.opportunity - signal.risk;
  let bonus = 0;
  let penalty = 0;

  if (signal.momentumLabel === "FORT") bonus += 8;
  if (smartCapitalState === "ACCUMULATION") bonus += 7;
  if (signal.opportunity > 55 && signal.momentumLabel !== "DÉTÉRIORATION") bonus += 5;
  if (flowDominance === "up") bonus += 5;
  if (flowEmission === "up") bonus += 4;
  if (signal.opportunity > 50 && signal.risk < 40) bonus += 3;
  if (signal.risk > 60) penalty += 15;
  if (smartCapitalState === "DISTRIBUTION") penalty += 12;
  if (signal.momentumLabel === "DÉTÉRIORATION" && signal.risk > 50) penalty += 8;

  return Math.round(clamp(asStandard + bonus - penalty, -100, 100));
}

export function detectPreHype(
  signal: SubnetSignal,
  smartCapitalState: string,
  flowDominance: "up" | "down" | "stable",
  flowEmission: "up" | "down" | "stable"
): { active: boolean; intensity: number } {
  let score = 0;
  if (signal.opportunity - signal.risk > 20 && signal.momentumLabel === "FORT") score += 20;
  if (smartCapitalState === "ACCUMULATION") score += 18;
  if (signal.momentumLabel === "FORT") score += 15;
  if (flowDominance === "up") score += 15;
  if (flowEmission === "up" && signal.psi < 70) score += 17;
  if (signal.opportunity > 50 && signal.risk < 35 && signal.stabilitySetup > 55) score += 15;
  const intensity = Math.round(clamp(score, 0, 100));
  return { active: score >= 45, intensity };
}

/** Compute Saturation Index (Section 9) */
export function computeSaturationIndex(signals: SubnetSignal[]): number {
  if (!signals.length) return 0;
  const highAS = signals.filter(s => (s.opportunity - s.risk) > 40).length;
  return Math.round((highAS / signals.length) * 100);
}

export function saturationAlert(pct: number): boolean {
  return pct > 60;
}

/* ═══════════════════════════════════════ */
/*   PROCESS SIGNALS (MAIN PIPELINE)        */
/* ═══════════════════════════════════════ */

export type ConsensusDataMap = Map<number, { confianceData: number; dataUncertain: boolean }>;

export function processSignals(
  raw: RawSignal[],
  sparklines: Record<number, number[]>,
  consensusMap?: ConsensusDataMap
): SubnetSignal[] {
  const filtered = raw.filter(s => s.netuid != null);
  if (!filtered.length) return [];

  // Step 1: Compute raw opportunity & risk
  const rawData = filtered.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    const consensus = consensusMap?.get(s.netuid!);
    const dataUncertain = consensus?.dataUncertain ?? false;

    let oppRaw = deriveOpportunity(psi, conf, quality, s.state);
    let riskRaw = deriveRisk(psi, conf, quality, s.state);

    // DATA_UNCERTAIN penalty on risk (Section 3.2)
    riskRaw = applyDataUncertaintyToRisk(riskRaw, dataUncertain);

    return { raw: s, psi, conf, quality, oppRaw, riskRaw, dataUncertain, confianceData: consensus?.confianceData ?? 50 };
  });

  // Step 2: Percentile mapping for Opp, S-curve for Risk
  const oppNormalized = normalizeOpportunity(rawData.map(d => d.oppRaw));
  const riskNormalized = normalizeWithVariance(rawData.map(d => d.riskRaw), 3);

  // Step 3: Build SubnetSignals
  const signals = rawData.map((d, i) => {
    const s = d.raw;
    let opportunity = oppNormalized[i];
    let risk = riskNormalized[i];
    const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";

    // Section 7: DEPEG/ZONE_CRITIQUE coherence
    if (isBreak || s.state === "DEPEG_WARNING" || s.state === "DEPEG_CRITICAL") {
      opportunity = 0;
    }

    // Risk Override Engine
    const override = evaluateRiskOverride({
      netuid: s.netuid!,
      state: s.state,
      psi: d.psi,
      risk,
      quality: d.quality,
    });

    if (override.isOverridden) {
      opportunity = 0;
    }

    // ── CALIBRATION: floor + critical override ──
    const cal = calibrateScores({
      risk, opportunity,
      state: s.state, isTopRank: false, isOverridden: override.isOverridden,
    });
    opportunity = cal.opportunity;
    risk = cal.risk;

    // AS signed (Section 4)
    const asRaw = cal.asymmetry;

    // DATA_UNCERTAIN penalty on AS (Section 4)
    const asFinal = d.dataUncertain ? asRaw - 15 : asRaw;

    const asymScore = d.conf * 0.6 + d.quality * 0.4;
    const asymmetry: Asymmetry = asymScore >= 75 ? "HIGH" : asymScore >= 55 ? "MED" : "LOW";
    const dominant = override.isOverridden ? "risk" as const :
                     opportunity > risk + 15 ? "opportunity" as const :
                     risk > opportunity + 15 ? "risk" as const : "neutral" as const;
    const momentumScore = computeMomentumScore(d.psi);
    const momentumLabel = deriveMomentumLabel(d.psi);
    const momentum = clamp(d.psi - 40, 0, 60) / 60 * 100;
    const stabilitySetup = computeStabilitySetup(opportunity, risk, d.conf, momentum, d.quality, d.dataUncertain);

    return {
      netuid: s.netuid!,
      name: s.subnet_name || `SN-${s.netuid}`,
      psi: d.psi,
      opportunity,
      risk,
      confidence: d.conf,
      state: deriveGaugeState(d.psi, d.conf, isBreak || override.isOverridden),
      phase: derivePhase(d.psi),
      asymmetry,
      sparkline_7d: (sparklines[s.netuid!] ?? []).slice(-7),
      liquidity: 50,
      momentum,
      momentumLabel,
      momentumScore,
      reasons: override.isOverridden ? override.overrideReasons : deriveReasons(d.psi, d.conf, d.quality, s.state, d.dataUncertain),
      dominant,
      isMicroCap: false,
      asMicro: 0,
      preHype: false,
      preHypeIntensity: 0,
      stabilitySetup,
      isOverridden: override.isOverridden,
      systemStatus: override.systemStatus,
      overrideReasons: override.overrideReasons,
      dataUncertain: d.dataUncertain,
      confianceData: d.confianceData,
    };
  }).sort((a, b) => b.psi - a.psi);

  classifyMicroCaps(signals);
  return signals;
}

/* ═══════════════════════════════════════ */
/*   SMART CAPITAL MODULE                   */
/* ═══════════════════════════════════════ */

export type SmartCapitalState = "ACCUMULATION" | "STABLE" | "DISTRIBUTION";

export type SmartCapitalData = {
  score: number;
  state: SmartCapitalState;
};

export function computeSmartCapital(raw: RawSignal[]): SmartCapitalData {
  if (!raw?.length) return { score: 50, state: "STABLE" };
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    const accumulationSignal = quality * 0.5 + conf * 0.3 + clamp(psi * 0.2, 0, 20);
    const distributionSignal = clamp((100 - quality) * 0.4, 0, 40) +
      (psi >= 80 && quality < 50 ? 30 : 0) +
      (s.state === "BREAK" || s.state === "EXIT_FAST" ? 25 : 0);
    return { acc: accumulationSignal, dist: distributionSignal };
  });
  const avgAcc = scores.reduce((a, s) => a + s.acc, 0) / scores.length;
  const avgDist = scores.reduce((a, s) => a + s.dist, 0) / scores.length;
  const scScore = Math.round(clamp(avgAcc - avgDist * 0.5 + 30, 0, 100));
  let state: SmartCapitalState;
  if (scScore >= 65) state = "ACCUMULATION";
  else if (scScore <= 35) state = "DISTRIBUTION";
  else state = "STABLE";
  return { score: scScore, state };
}

/* ═══════════════════════════════════════ */
/*   DUAL CORE STRATEGY                     */
/* ═══════════════════════════════════════ */

export type DualCoreAllocation = {
  structurePct: number;
  sniperPct: number;
  structureNetuids: number[];
  sniperNetuids: number[];
};

export function computeDualCore(signals: SubnetSignal[], smartCapital: SmartCapitalData): DualCoreAllocation {
  if (!signals.length) return { structurePct: 65, sniperPct: 35, structureNetuids: [], sniperNetuids: [] };
  const structure = signals
    .filter(s => s.confidence >= 60 && s.risk < 50 && s.asymmetry !== "HIGH")
    .sort((a, b) => (b.opportunity * 0.6 + b.confidence * 0.4) - (a.opportunity * 0.6 + a.confidence * 0.4))
    .slice(0, 4);
  const sniper = signals
    .filter(s => s.asymmetry === "HIGH" || (s.opportunity >= 65 && s.confidence < 70))
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, 3);
  let structurePct = 65;
  let sniperPct = 35;
  if (smartCapital.state === "ACCUMULATION") { structurePct = 55; sniperPct = 45; }
  else if (smartCapital.state === "DISTRIBUTION") { structurePct = 75; sniperPct = 25; }
  return { structurePct, sniperPct, structureNetuids: structure.map(s => s.netuid), sniperNetuids: sniper.map(s => s.netuid) };
}

/* Compute global scores */
export function computeGlobalPsi(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const mpis = raw.map(s => s.mpi ?? s.score ?? 0).filter(m => m > 0);
  if (!mpis.length) return 0;
  const totalW = mpis.reduce((a, m) => a + m, 0);
  const weighted = mpis.reduce((a, m) => a + m * m, 0);
  return Math.round(weighted / totalW);
}

export function computeGlobalConfidence(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const confs = raw.map(s => s.confidence_pct ?? 0).filter(c => c > 0);
  return confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
}

export function computeGlobalOpportunity(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    return deriveOpportunity(psi, conf, quality, s.state);
  });
  if (!scores.length) return 0;
  const normalized = normalizeWithVariance(scores, 3);
  const sorted = [...normalized].sort((a, b) => b - a);
  const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
  const topAvg = top25.reduce((a, b) => a + b, 0) / top25.length;
  const allAvg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return Math.round(topAvg * 0.6 + allAvg * 0.4);
}

export function computeGlobalRisk(raw: RawSignal[]): number {
  if (!raw?.length) return 0;
  const scores = raw.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    return deriveRisk(psi, conf, quality, s.state);
  });
  if (!scores.length) return 0;
  const normalized = normalizeWithVariance(scores, 3);
  const sorted = [...normalized].sort((a, b) => b - a);
  const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
  const topAvg = top25.reduce((a, b) => a + b, 0) / top25.length;
  const allAvg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return Math.round(topAvg * 0.5 + allAvg * 0.5);
}
