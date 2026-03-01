/* ═══════════════════════════════════════ */
/*   GAUGE ENGINE — SMART CAPITAL + GLOBAL  */
/* ═══════════════════════════════════════ */

import { clamp, type SmartCapitalData, type SmartCapitalState, type SubnetSignal, type RawSignal, type DualCoreAllocation } from "./gauge-types";
import { normalizeWithVariance } from "./gauge-normalize";
import { deriveOpportunity, deriveRisk } from "./gauge-signals";

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
