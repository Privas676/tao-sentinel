/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — SIGNAL PROCESSING       */
/* ═══════════════════════════════════════ */

import { evaluateRiskOverride, capOpportunity } from "./risk-override";
import { calibrateScores } from "./risk-calibration";
import {
  clamp, PSI_THRESHOLDS,
  type GaugeState, type GaugePhase, type Asymmetry,
  type SubnetSignal, type RawSignal, type MarketRiskData,
  type ConsensusDataMap,
} from "./gauge-types";
import { normalizeOpportunity, normalizeWithVariance } from "./gauge-normalize";
import {
  computeMomentumScore, deriveMomentumLabel, computeStabilitySetup,
} from "./gauge-momentum";

/* ── State & Phase derivation ── */

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

/* ── Opportunity / Risk derivation ── */

export function deriveOpportunity(psi: number, conf: number, quality: number, state: string | null): number {
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

export function deriveRisk(psi: number, conf: number, quality: number, state: string | null, market?: MarketRiskData): number {
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

/* ── Colors ── */

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

/* ── Micro-cap + Pre-hype ── */

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

export function computeSaturationIndex(signals: SubnetSignal[]): number {
  if (!signals.length) return 0;
  const highAS = signals.filter(s => (s.opportunity - s.risk) > 40).length;
  return Math.round((highAS / signals.length) * 100);
}

export function saturationAlert(pct: number): boolean {
  return pct > 60;
}

/* ── Main pipeline ── */

export function processSignals(
  raw: RawSignal[],
  sparklines: Record<number, number[]>,
  consensusMap?: ConsensusDataMap
): SubnetSignal[] {
  const filtered = raw.filter(s => s.netuid != null);
  if (!filtered.length) return [];

  const rawData = filtered.map(s => {
    const psi = s.mpi ?? s.score ?? 0;
    const conf = s.confidence_pct ?? 0;
    const quality = s.quality_score ?? 0;
    const consensus = consensusMap?.get(s.netuid!);
    const dataUncertain = consensus?.dataUncertain ?? false;
    let oppRaw = deriveOpportunity(psi, conf, quality, s.state);
    let riskRaw = deriveRisk(psi, conf, quality, s.state);
    riskRaw = applyDataUncertaintyToRisk(riskRaw, dataUncertain);
    return { raw: s, psi, conf, quality, oppRaw, riskRaw, dataUncertain, confianceData: consensus?.confianceData ?? 50 };
  });

  const oppNormalized = normalizeOpportunity(rawData.map(d => d.oppRaw));
  const riskNormalized = normalizeWithVariance(rawData.map(d => d.riskRaw), 3);

  const signals = rawData.map((d, i) => {
    const s = d.raw;
    let opportunity = oppNormalized[i];
    let risk = riskNormalized[i];
    const isBreak = s.state === "BREAK" || s.state === "EXIT_FAST";
    if (isBreak || s.state === "DEPEG_WARNING" || s.state === "DEPEG_CRITICAL") {
      opportunity = 0;
    }
    const override = evaluateRiskOverride({
      netuid: s.netuid!, state: s.state, psi: d.psi, risk, quality: d.quality,
    });
    if (override.isOverridden) opportunity = 0;

    const cal = calibrateScores({
      risk, opportunity, state: s.state, isTopRank: false, isOverridden: override.isOverridden,
    });
    opportunity = cal.opportunity;
    risk = cal.risk;

    const asRaw = cal.asymmetry;
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
      opportunity, risk,
      confidence: d.conf,
      state: deriveGaugeState(d.psi, d.conf, isBreak || override.isOverridden),
      phase: derivePhase(d.psi),
      asymmetry,
      sparkline_7d: (sparklines[s.netuid!] ?? []).slice(-7),
      liquidity: 50,
      momentum, momentumLabel, momentumScore,
      reasons: override.isOverridden ? override.overrideReasons : deriveReasons(d.psi, d.conf, d.quality, s.state, d.dataUncertain),
      dominant,
      isMicroCap: false, asMicro: 0,
      preHype: false, preHypeIntensity: 0,
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
