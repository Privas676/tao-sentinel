/* ═══════════════════════════════════════ */
/*     ALIEN GAUGE — OPPORTUNITY/RISK ENGINE */
/* ═══════════════════════════════════════ */
import { evaluateRiskOverride, capOpportunity } from "./risk-override";


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
  reasons: string[];
  dominant: "opportunity" | "risk" | "neutral";
  // Micro-cap fields
  isMicroCap: boolean;
  asMicro: number;
  preHype: boolean;
  preHypeIntensity: number;
  stabilitySetup: number;
  // Risk Override fields
  isOverridden: boolean;
  systemStatus: import("./risk-override").SystemStatus;
  overrideReasons: string[];
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
/* ═══════════════════════════════════════ */

/** Sigmoid S-curve: amplifies extremes, compresses middle */
function sigmoid(x: number, steepness = 10, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

/** Convert raw scores to percentile ranks (0-100) */
function percentileRank(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 50);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    const equal = sorted.filter(s => s === v).length;
    return ((below + equal * 0.5) / sorted.length) * 100;
  });
}

/** Apply S-curve to percentile-normalized scores for high variance.
 *  steepness=6 gives a gentler curve that preserves mid-range differentiation */
function applySCurve(percentile: number, steepness = 6): number {
  const normalized = percentile / 100;
  const curved = sigmoid(normalized, steepness, 0.5);
  const min = sigmoid(0, steepness, 0.5);
  const max = sigmoid(1, steepness, 0.5);
  return Math.round(((curved - min) / (max - min)) * 100);
}

/** Normalize an array of scores using percentile + S-curve */
export function normalizeWithVariance(rawScores: number[], steepness = 6): number[] {
  const ranks = percentileRank(rawScores);
  return ranks.map(r => applySCurve(r, steepness));
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

/* Momentum label from PSI */
export function deriveMomentumLabel(psi: number, prevPsi?: number): MomentumLabel {
  const delta = prevPsi != null ? psi - prevPsi : 0;
  if (psi >= 70 && delta >= 0) return "FORT";
  if (psi >= 45 && delta >= -5) return "MODÉRÉ";
  if (delta < -10) return "DÉTÉRIORATION";
  return "STABLE";
}

export function momentumColor(label: MomentumLabel): string {
  switch (label) {
    case "FORT": return "rgba(76,175,80,0.85)";
    case "MODÉRÉ": return "rgba(255,193,7,0.8)";
    case "STABLE": return "rgba(255,255,255,0.4)";
    case "DÉTÉRIORATION": return "rgba(229,57,53,0.8)";
  }
}

/* Stabilité Setup (0-100%) — stability of asymmetry/risk/volatility */
export function computeStabilitySetup(
  opportunity: number,
  risk: number,
  confidence: number,
  momentum: number,
  quality: number
): number {
  // Higher stability = less volatile, more consistent signals
  const asymStability = clamp(100 - Math.abs(opportunity - risk) * 0.3, 0, 40);
  const confStability = clamp(confidence * 0.3, 0, 30);
  const momentumStability = momentum >= 35 && momentum <= 75 ? 20 : clamp(20 - Math.abs(momentum - 55) * 0.4, 0, 20);
  const qualityBonus = clamp(quality * 0.1, 0, 10);
  return Math.round(clamp(asymStability + confStability + momentumStability + qualityBonus, 0, 100));
}

export function stabilityColor(pct: number): string {
  if (pct >= 75) return "rgba(76,175,80,0.85)";
  if (pct >= 50) return "rgba(255,193,7,0.8)";
  if (pct >= 30) return "rgba(255,109,0,0.8)";
  return "rgba(229,57,53,0.7)";
}

/* ═══════════════════════════════════════ */
/*   OPPORTUNITY / RISK ENGINE              */
/* ═══════════════════════════════════════ */

function deriveOpportunity(psi: number, conf: number, quality: number, state: string | null): number {
  // Use non-linear components to maximize differentiation
  let opp = 0;
  // PSI contribution with quadratic boost for high values
  opp += (psi / 100) * (psi / 100) * 35; // 0-35, quadratic
  // Confidence: linear but wider range
  opp += clamp(conf * 0.30, 0, 30);
  // Quality with threshold bonus
  opp += clamp(quality * 0.20, 0, 20);
  // State bonuses (significant differentiation)
  if (state === "GO") opp += 15;
  else if (state === "GO_SPECULATIVE" || state === "EARLY") opp += 10;
  else if (state === "WATCH") opp += 3;
  else if (state === "BREAK" || state === "EXIT_FAST") opp -= 10;
  // Interaction term: high PSI + high quality = extra boost
  if (psi >= 60 && quality >= 60) opp += 8;
  // Low PSI penalty
  if (psi < 30) opp -= 5;
  return Math.round(clamp(opp, 0, 100));
}

function deriveRisk(psi: number, conf: number, quality: number, state: string | null): number {
  let risk = 0;
  // State is the strongest risk differentiator
  if (state === "BREAK" || state === "EXIT_FAST") risk += 40;
  else if (state === "HOLD") risk += 5;
  // Quality deficit: quadratic to amplify low quality
  const qualDeficit = (100 - quality) / 100;
  risk += qualDeficit * qualDeficit * 30; // 0-30, quadratic
  // Confidence deficit
  const confDeficit = (100 - conf) / 100;
  risk += confDeficit * confDeficit * 20; // 0-20, quadratic
  // Overheated: very high PSI with low quality = speculative risk
  if (psi >= 80 && quality < 50) risk += 15;
  if (psi >= 90 && quality < 40) risk += 10;
  // Low PSI can mean stagnation risk
  if (psi < 25) risk += 8;
  // Moderate PSI with low confidence
  if (psi >= 40 && psi <= 60 && conf < 40) risk += 5;
  return Math.round(clamp(risk, 0, 100));
}

function deriveReasons(
  psi: number, conf: number, quality: number,
  state: string | null, lang: "fr" | "en" = "fr"
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
  return reasons.slice(0, 3);
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

/** Determine if a subnet is micro-cap (bottom 40% by cap proxy) */
export function classifyMicroCaps(signals: SubnetSignal[]): void {
  // Use inverse of opportunity+confidence as cap proxy (lower = smaller cap)
  const sorted = [...signals].sort((a, b) => (a.confidence + a.psi) - (b.confidence + b.psi));
  const cutoff = Math.ceil(sorted.length * 0.4);
  const microNetuids = new Set(sorted.slice(0, cutoff).map(s => s.netuid));
  for (const s of signals) {
    s.isMicroCap = microNetuids.has(s.netuid);
  }
}

/** Compute AS_micro = AS + BonusCroissance + BonusFlux - PénalitéRisqueExtrême */
export function computeASMicro(
  signal: SubnetSignal,
  smartCapitalState: string,
  flowDominance: "up" | "down" | "stable",
  flowEmission: "up" | "down" | "stable"
): number {
  const asStandard = signal.opportunity - signal.risk;
  let bonus = 0;
  let penalty = 0;

  // BonusCroissance
  if (signal.momentumLabel === "FORT") bonus += 8;
  if (smartCapitalState === "ACCUMULATION") bonus += 7;
  if (signal.opportunity > 55 && signal.momentumLabel !== "DÉTÉRIORATION") bonus += 5;

  // BonusFlux
  if (flowDominance === "up") bonus += 5;
  if (flowEmission === "up") bonus += 4;
  if (signal.opportunity > 50 && signal.risk < 40) bonus += 3;

  // PénalitéRisqueExtrême
  if (signal.risk > 60) penalty += 15;
  if (smartCapitalState === "DISTRIBUTION") penalty += 12;
  if (signal.momentumLabel === "DÉTÉRIORATION" && signal.risk > 50) penalty += 8;

  return Math.round(clamp(asStandard + bonus - penalty, -100, 100));
}

/** Detect Pré-Hype condition (≥3 of 6 criteria met) */
export function detectPreHype(
  signal: SubnetSignal,
  smartCapitalState: string,
  flowDominance: "up" | "down" | "stable",
  flowEmission: "up" | "down" | "stable"
): { active: boolean; intensity: number } {
  let score = 0;

  // 1. Accélération rapide du score asymétrie
  if (signal.opportunity - signal.risk > 20 && signal.momentumLabel === "FORT") score += 20;

  // 2. Smart Capital passe de Neutre à Accumulation
  if (smartCapitalState === "ACCUMULATION") score += 18;

  // 3. Momentum passe de Stable à Fort
  if (signal.momentumLabel === "FORT") score += 15;

  // 4. Augmentation dominance faible mais croissante
  if (flowDominance === "up") score += 15;

  // 5. Hausse émission relative avant hausse volume
  if (flowEmission === "up" && signal.psi < 70) score += 17;

  // 6. Volatilité contenue malgré hausse opportunité
  if (signal.opportunity > 50 && signal.risk < 35 && signal.stabilitySetup > 55) score += 15;

  const intensity = Math.round(clamp(score, 0, 100));
  const active = score >= 45; // Roughly 3+ conditions met

  return { active, intensity };
}

/** Compute Saturation Index — % of subnets with AS > 40 */
export function computeSaturationIndex(signals: SubnetSignal[]): number {
  if (!signals.length) return 0;
  const highAS = signals.filter(s => (s.opportunity - s.risk) > 40).length;
  return Math.round((highAS / signals.length) * 100);
}

export function saturationAlert(pct: number): boolean {
  return pct > 60;
}

export function processSignals(
  raw: RawSignal[],
  sparklines: Record<number, number[]>
): SubnetSignal[] {
  const filtered = raw.filter(s => s.netuid != null);
  if (!filtered.length) return [];

  // Step 1: Compute raw opportunity & risk for all subnets
  const rawData = filtered.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    return {
      raw: s, psi, conf, quality,
      oppRaw: deriveOpportunity(psi, conf, quality, s.state),
      riskRaw: deriveRisk(psi, conf, quality, s.state),
    };
  });

  // Step 2: Percentile + S-curve normalization for high variance
  const oppNormalized = capOpportunity(normalizeWithVariance(rawData.map(d => d.oppRaw), 8));
  const riskNormalized = normalizeWithVariance(rawData.map(d => d.riskRaw), 8);

  // Step 3: Build SubnetSignals with normalized scores + risk override
  const signals = rawData.map((d, i) => {
    const s = d.raw;
    let opportunity = oppNormalized[i];
    const risk = riskNormalized[i];
    const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";

    // Risk Override Engine — AFTER score calculation
    const override = evaluateRiskOverride({
      state: s.state,
      psi: d.psi,
      risk,
      quality: d.quality,
    });

    // If overridden: AS_final = 0 (opportunity zeroed)
    if (override.isOverridden) {
      opportunity = 0;
    }

    const asymScore = d.conf * 0.6 + d.quality * 0.4;
    const asymmetry: Asymmetry = asymScore >= 75 ? "HIGH" : asymScore >= 55 ? "MED" : "LOW";
    const dominant = override.isOverridden ? "risk" as const :
                     opportunity > risk + 15 ? "opportunity" as const :
                     risk > opportunity + 15 ? "risk" as const : "neutral" as const;
    const momentum = clamp(d.psi - 40, 0, 60) / 60 * 100;
    const momentumLabel = deriveMomentumLabel(d.psi);
    const stabilitySetup = computeStabilitySetup(opportunity, risk, d.conf, momentum, d.quality);
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
      reasons: override.isOverridden ? override.overrideReasons : deriveReasons(d.psi, d.conf, d.quality, s.state),
      dominant,
      isMicroCap: false,
      asMicro: 0,
      preHype: false,
      preHypeIntensity: 0,
      stabilitySetup,
      isOverridden: override.isOverridden,
      systemStatus: override.systemStatus,
      overrideReasons: override.overrideReasons,
    };
  }).sort((a, b) => b.psi - a.psi);

  // Classify micro-caps
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
  const normalized = normalizeWithVariance(scores, 8);
  // Global = weighted average favoring top quartile
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
  const normalized = normalizeWithVariance(scores, 8);
  // Global risk = weighted average favoring highest risks
  const sorted = [...normalized].sort((a, b) => b - a);
  const top25 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.25)));
  const topAvg = top25.reduce((a, b) => a + b, 0) / top25.length;
  const allAvg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  return Math.round(topAvg * 0.5 + allAvg * 0.5);
}
