/* ═══════════════════════════════════════ */
/*   MACRO RECOMMENDATION + SENTINEL INDEX */
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
  if (sentinelIndex < 35 || smartCapitalState === "DISTRIBUTION") return "REDUCE";
  if (globalStability < 30 && sentinelIndex < 50) return "REDUCE";
  if (sentinelIndex >= 65 && smartCapitalState === "ACCUMULATION" && confianceData >= 50) return "INCREASE";
  if (sentinelIndex >= 55 && globalStability >= 60 && smartCapitalState === "ACCUMULATION") return "INCREASE";
  if (sentinelIndex < 45 && globalStability < 45) return "REDUCE";
  return "NEUTRAL";
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
