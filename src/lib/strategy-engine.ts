/* ═══════════════════════════════════════ */
/*   STRATEGY ENGINE — DECISION RULES      */
/* ═══════════════════════════════════════ */

import type { SmartCapitalState } from "./gauge-engine";
type SCState = SmartCapitalState | string;

export type MacroRecommendation = "INCREASE" | "REDUCE" | "NEUTRAL";

export function deriveMacroRecommendation(
  sentinelIndex: number,
  smartCapitalState: SCState,
  globalStability: number,
  confianceData: number
): MacroRecommendation {
  // Strong reduce signals
  if (sentinelIndex < 35 || smartCapitalState === "DISTRIBUTION") return "REDUCE";
  if (globalStability < 30 && sentinelIndex < 50) return "REDUCE";
  
  // Strong increase signals
  if (sentinelIndex >= 65 && smartCapitalState === "ACCUMULATION" && confianceData >= 50) return "INCREASE";
  if (sentinelIndex >= 55 && globalStability >= 60 && smartCapitalState === "ACCUMULATION") return "INCREASE";
  
  // Moderate reduce
  if (sentinelIndex < 45 && globalStability < 45) return "REDUCE";
  
  return "NEUTRAL";
}

export function macroColor(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.9)";
    case "NEUTRAL": return "rgba(255,193,7,0.9)";
    case "REDUCE": return "rgba(229,57,53,0.9)";
  }
}

export function macroBg(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.08)";
    case "NEUTRAL": return "rgba(255,193,7,0.06)";
    case "REDUCE": return "rgba(229,57,53,0.08)";
  }
}

export function macroBorder(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "rgba(76,175,80,0.25)";
    case "NEUTRAL": return "rgba(255,193,7,0.2)";
    case "REDUCE": return "rgba(229,57,53,0.25)";
  }
}

export function macroIcon(rec: MacroRecommendation): string {
  switch (rec) {
    case "INCREASE": return "📈";
    case "NEUTRAL": return "⚖️";
    case "REDUCE": return "📉";
  }
}

export type StrategicAction = "ENTER" | "WATCH" | "EXIT" | "STAKE" | "NEUTRAL" | "HOLD";
export type StrategyMode = "hunter" | "defensive" | "bagbuilder";

const THRESHOLDS: Record<StrategyMode, {
  enterOpp: number; enterRisk: number; enterConf: number;
  watchOpp: number; watchRisk: number;
  exitRisk: number; moderateRisk: number;
}> = {
  hunter:     { enterOpp: 55, enterRisk: 40, enterConf: 45, watchOpp: 45, watchRisk: 50, exitRisk: 70, moderateRisk: 50 },
  defensive:  { enterOpp: 75, enterRisk: 25, enterConf: 65, watchOpp: 60, watchRisk: 35, exitRisk: 55, moderateRisk: 35 },
  bagbuilder: { enterOpp: 60, enterRisk: 35, enterConf: 50, watchOpp: 50, watchRisk: 45, exitRisk: 65, moderateRisk: 45 },
};

export function deriveStrategicAction(
  opportunity: number,
  risk: number,
  smartCapitalState: SCState,
  confidence: number,
  mode: StrategyMode = "hunter",
  stabilitySetup?: number
): StrategicAction {
  const t = THRESHOLDS[mode];

  if (risk > t.exitRisk) return "EXIT";
  if (smartCapitalState === "DISTRIBUTION") return "EXIT";

  // ENTER with stability check
  const stabilityOk = stabilitySetup == null || stabilitySetup > 65;
  if (
    opportunity > t.enterOpp &&
    risk < t.enterRisk &&
    smartCapitalState === "ACCUMULATION" &&
    confidence > t.enterConf &&
    stabilityOk
  ) return "ENTER";

  if (
    opportunity >= t.watchOpp &&
    risk <= t.watchRisk &&
    smartCapitalState !== "DISTRIBUTION"
  ) return "WATCH";

  if (risk > t.moderateRisk) return "EXIT";
  return "WATCH";
}

/** Derive strategic action for micro-cap aware recommendation */
export function deriveStrategicActionMicro(
  asMicro: number,
  risk: number,
  smartCapitalState: SCState,
  stabilitySetup: number,
  mode: StrategyMode = "hunter"
): StrategicAction {
  const t = THRESHOLDS[mode];

  if (risk > t.exitRisk) return "EXIT";
  if (smartCapitalState === "DISTRIBUTION") return "EXIT";

  if (
    asMicro > 25 &&
    risk < t.enterRisk &&
    smartCapitalState === "ACCUMULATION" &&
    stabilitySetup > 65
  ) return "ENTER";

  if (asMicro > 10 && risk <= t.watchRisk) return "WATCH";
  if (risk > t.moderateRisk) return "EXIT";
  return "WATCH";
}

export function actionColor(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.9)";
    case "WATCH": return "rgba(255,193,7,0.9)";
    case "EXIT": return "rgba(229,57,53,0.9)";
    case "STAKE": return "rgba(100,181,246,0.9)";
    case "NEUTRAL": return "rgba(158,158,158,0.9)";
    case "HOLD": return "rgba(100,181,246,0.9)";
  }
}

export function actionBg(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.08)";
    case "WATCH": return "rgba(255,193,7,0.06)";
    case "EXIT": return "rgba(229,57,53,0.08)";
    case "STAKE": return "rgba(100,181,246,0.06)";
    case "NEUTRAL": return "rgba(158,158,158,0.06)";
    case "HOLD": return "rgba(100,181,246,0.06)";
  }
}

export function actionBorder(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.25)";
    case "WATCH": return "rgba(255,193,7,0.2)";
    case "EXIT": return "rgba(229,57,53,0.25)";
    case "STAKE": return "rgba(100,181,246,0.2)";
    case "NEUTRAL": return "rgba(158,158,158,0.2)";
    case "HOLD": return "rgba(100,181,246,0.2)";
  }
}

export function actionIcon(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "🟢";
    case "WATCH": return "🟡";
    case "EXIT": return "🔴";
    case "STAKE": return "🔵";
    case "NEUTRAL": return "⚪";
    case "HOLD": return "🔷";
  }
}

/** Compute Global TAO Sentinel Index (0-100) */
export function computeSentinelIndex(
  opportunity: number,
  risk: number,
  smartCapitalScore: number
): number {
  const score = opportunity * 0.45 - risk * 0.35 + smartCapitalScore * 0.20;
  return Math.round(Math.max(0, Math.min(100, score + 20)));
}

export function sentinelIndexColor(score: number): string {
  if (score >= 65) return "rgba(76,175,80,0.9)";
  if (score >= 45) return "rgba(255,193,7,0.9)";
  return "rgba(229,57,53,0.9)";
}

export function sentinelIndexLabel(score: number, lang: "fr" | "en"): string {
  if (score >= 65) return lang === "fr" ? "OFFENSIF" : "OFFENSIVE";
  if (score >= 45) return lang === "fr" ? "NEUTRE" : "NEUTRAL";
  return lang === "fr" ? "DÉFENSIF" : "DEFENSIVE";
}

/** Derive per-subnet action */
export function deriveSubnetAction(
  opp: number,
  risk: number,
  conf: number
): StrategicAction {
  if (risk > 60) return "EXIT";
  if (opp > 60 && risk < 35 && conf > 50) return "ENTER";
  if (opp >= 45 && risk <= 50) return "WATCH";
  if (risk > 45) return "EXIT";
  return "WATCH";
}
