/* ═══════════════════════════════════════ */
/*   STRATEGY ENGINE — DECISION RULES      */
/* ═══════════════════════════════════════ */

import type { SmartCapitalState } from "./gauge-engine";
type SCState = SmartCapitalState | string;

export type StrategicAction = "ENTER" | "WATCH" | "EXIT";

export function deriveStrategicAction(
  opportunity: number,
  risk: number,
  smartCapitalState: SCState,
  confidence: number
): StrategicAction {
  // EXIT rules
  if (risk > 70) return "EXIT";
  if (smartCapitalState === "DISTRIBUTION") return "EXIT";

  // ENTER rules
  if (
    opportunity > 60 &&
    risk < 35 &&
    smartCapitalState === "ACCUMULATION" &&
    confidence > 50
  ) return "ENTER";

  // WATCH rules (middle ground)
  if (
    opportunity >= 50 &&
    risk <= 45 &&
    smartCapitalState !== "DISTRIBUTION"
  ) return "WATCH";

  // Default: if risk moderate or opportunity low
  if (risk > 45) return "EXIT";
  return "WATCH";
}

export function actionColor(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.9)";
    case "WATCH": return "rgba(255,193,7,0.9)";
    case "EXIT": return "rgba(229,57,53,0.9)";
  }
}

export function actionBg(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.08)";
    case "WATCH": return "rgba(255,193,7,0.06)";
    case "EXIT": return "rgba(229,57,53,0.08)";
  }
}

export function actionBorder(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "rgba(76,175,80,0.25)";
    case "WATCH": return "rgba(255,193,7,0.2)";
    case "EXIT": return "rgba(229,57,53,0.25)";
  }
}

export function actionIcon(action: StrategicAction): string {
  switch (action) {
    case "ENTER": return "🟢";
    case "WATCH": return "🟡";
    case "EXIT": return "🔴";
  }
}

/** Compute Global TAO Sentinel Index (0-100) */
export function computeSentinelIndex(
  opportunity: number,
  risk: number,
  smartCapitalScore: number
): number {
  // Weighted synthetic score
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
