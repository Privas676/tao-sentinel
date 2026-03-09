/* ═══════════════════════════════════════════════════════ */
/*   UNIFIED SUBNET DECISION — Single Source of Truth      */
/*   Every page MUST read from this object.                */
/*   NO local re-derivation allowed.                       */
/* ═══════════════════════════════════════════════════════ */

import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import type { SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import type { StrategicAction } from "@/lib/strategy-subnet";
import { actionLabelFr, actionLabelEn } from "@/lib/strategy-colors";

/* ── Types ── */

export type DecisionAction = "ENTRER" | "RENFORCER" | "ATTENDRE" | "SURVEILLER" | "SORTIR" | "SYSTÈME" | "SYSTEM";

export type ConvictionLevel = "HIGH" | "MEDIUM" | "LOW";
export type LiquidityLevel = "HIGH" | "MEDIUM" | "LOW";
export type StructureLevel = "HEALTHY" | "FRAGILE" | "CONCENTRATED";
export type StatusLevel = "OK" | "WATCH" | "DANGER";

/** Portfolio-specific action for positions already held */
export type PortfolioAction = "RENFORCER" | "CONSERVER" | "REDUIRE" | "SORTIR";

/**
 * The single decision object per subnet.
 * All pages consume this — no local re-derivation.
 */
export type SubnetDecision = {
  netuid: number;
  name: string;

  /* ── Final engine action (from UnifiedSubnetScore) ── */
  engineAction: StrategicAction;

  /* ── Unified decision label (French) ── */
  actionFr: DecisionAction;
  actionEn: string;

  /* ── ActionBadge key for the ActionBadge component ── */
  badgeAction: "RENTRE" | "SORS" | "RENFORCER" | "HOLD" | "SURVEILLER" | "ATTENDRE" | "SYSTEME";

  /* ── System subnet flag ── */
  isSystem: boolean;

  /* ── Portfolio action (for held positions) ── */
  portfolioAction: PortfolioAction;
  portfolioActionFr: string;
  portfolioActionEn: string;

  /* ── Conviction ── */
  conviction: ConvictionLevel;
  convictionScore: number;

  /* ── Core scores (direct from engine) ── */
  opp: number;
  risk: number;
  asymmetry: number;
  confidence: number;  // confianceScore
  momentumScore: number;
  momentumLabel: string;
  stability: number;

  /* ── Derived levels ── */
  liquidityLevel: LiquidityLevel;
  structureLevel: StructureLevel;
  statusLevel: StatusLevel;

  /* ── Signal / Reason — single source ── */
  signalPrincipal: string;
  thesis: string[];
  invalidation: string[];
  conflictExplanation: string | null;

  /* ── Flags ── */
  isOverridden: boolean;
  dataUncertain: boolean;
  depegProbability: number;
  delistCategory: string;
  delistScore: number;

  /* ── Raw references for deep-dive ── */
  score: UnifiedSubnetScore;
  verdict?: SubnetVerdictData;
};

/* ── Derivation helpers (PRIVATE — only used here) ── */

function deriveConviction(s: UnifiedSubnetScore, v?: SubnetVerdictData): { level: ConvictionLevel; score: number } {
  const raw = v ? Math.max(v.entryScore, v.holdScore) : Math.abs(s.opp - s.risk) * (s.conf / 100);
  const score = Math.round(raw);
  return { level: score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW", score };
}

function deriveLiquidity(healthScore: number): LiquidityLevel {
  return healthScore >= 60 ? "HIGH" : healthScore >= 30 ? "MEDIUM" : "LOW";
}

function deriveStructure(stability: number, isOverridden: boolean): StructureLevel {
  if (isOverridden) return "CONCENTRATED";
  return stability >= 60 ? "HEALTHY" : stability >= 35 ? "FRAGILE" : "CONCENTRATED";
}

function deriveStatus(s: UnifiedSubnetScore): StatusLevel {
  if (s.isOverridden || s.systemStatus === "ZONE_CRITIQUE" || s.systemStatus === "DEPEG" || s.systemStatus === "DEREGISTRATION") return "DANGER";
  if (s.isWarning || s.systemStatus === "SURVEILLANCE") return "WATCH";
  return "OK";
}

function deriveActionFr(action: StrategicAction): DecisionAction {
  switch (action) {
    case "ENTER": return "ENTRER";
    case "STAKE": return "RENFORCER";
    case "EXIT": return "SORTIR";
    case "WATCH": return "SURVEILLER";
    case "NEUTRAL": return "SURVEILLER";
    case "HOLD": return "ATTENDRE";
  }
}

function deriveBadgeAction(action: StrategicAction, isSystem: boolean): SubnetDecision["badgeAction"] {
  if (isSystem) return "SYSTEME";
  switch (action) {
    case "ENTER": return "RENTRE";
    case "EXIT": return "SORS";
    case "STAKE": return "RENFORCER";
    case "WATCH": return "SURVEILLER";
    case "NEUTRAL": return "ATTENDRE";
    case "HOLD": return "HOLD";
  }
}

function derivePortfolioAction(s: UnifiedSubnetScore, reconciledAction?: StrategicAction): PortfolioAction {
  const action = reconciledAction || s.action;
  if (s.isOverridden || action === "EXIT") return "SORTIR";
  if (s.risk > 65 || s.depegProbability >= 40) return "REDUIRE";
  if (action === "ENTER" || action === "STAKE") return "RENFORCER";
  return "CONSERVER";
}

function portfolioActionLabelFr(a: PortfolioAction): string {
  switch (a) {
    case "RENFORCER": return "RENFORCER";
    case "CONSERVER": return "CONSERVER";
    case "REDUIRE": return "RÉDUIRE";
    case "SORTIR": return "SORTIR";
  }
}

function portfolioActionLabelEn(a: PortfolioAction): string {
  switch (a) {
    case "RENFORCER": return "REINFORCE";
    case "CONSERVER": return "HOLD";
    case "REDUIRE": return "REDUCE";
    case "SORTIR": return "EXIT";
  }
}

/**
 * Build the main signal text — single source, used everywhere.
 */
function deriveSignalPrincipal(s: UnifiedSubnetScore, fr: boolean): string {
  const special = SPECIAL_SUBNETS[s.netuid];
  if (special?.isSystem) return fr ? "Infrastructure réseau" : "Network infrastructure";
  if (s.isOverridden) return s.overrideReasons[0] || (fr ? "Zone critique" : "Critical zone");
  if (s.depegProbability >= 50) return `Depeg ${s.depegProbability}%`;
  if (s.delistCategory !== "NORMAL") return fr ? "Risque delist" : "Delist risk";
  if (s.action === "ENTER" && s.opp > 60) return fr ? "Forte opportunité" : "Strong opportunity";
  if (s.action === "EXIT") return fr ? "Signal de sortie" : "Exit signal";
  if (s.momentumScore >= 70) return fr ? "Momentum haussier" : "Bullish momentum";
  if (s.risk > 60) return fr ? "Risque élevé" : "High risk";
  return fr ? "Stable" : "Stable";
}

/**
 * Derive conflict explanation when verdict seems contradictory.
 * e.g. high entry score but HOLD verdict due to safety guards.
 */
function deriveConflictExplanation(s: UnifiedSubnetScore, v?: SubnetVerdictData, fr = true): string | null {
  if (!v) return null;

  // High entry score but not RENTRE
  if (v.entryScore >= 55 && v.verdict !== "RENTRE") {
    if (s.isOverridden) {
      return fr
        ? `Signal fort (entry ${v.entryScore}), bloqué par override de protection.`
        : `Strong signal (entry ${v.entryScore}), blocked by protection override.`;
    }
    if (v.exitRisk >= 55) {
      return fr
        ? `Signal d'entrée ${v.entryScore}, mais risque structurel trop élevé (${v.exitRisk}).`
        : `Entry signal ${v.entryScore}, but structural risk too high (${v.exitRisk}).`;
    }
    if (v.dataReliability === "stale" || v.dataReliability === "suspect") {
      return fr
        ? `Signal fort (entry ${v.entryScore}), mais données insuffisantes — verdict prudent.`
        : `Strong signal (entry ${v.entryScore}), but insufficient data — prudent verdict.`;
    }
    if (s.confianceScore < 50) {
      return fr
        ? `Opportunité détectée (${v.entryScore}), fiabilité limitée (${s.confianceScore}%).`
        : `Opportunity detected (${v.entryScore}), limited reliability (${s.confianceScore}%).`;
    }
    // Generic safety guard block
    return fr
      ? `Signal fort (entry ${v.entryScore}), bloqué par garde-fous structurels.`
      : `Strong signal (entry ${v.entryScore}), blocked by structural safety guards.`;
  }

  // SORS but low exit risk (shouldn't happen normally, but flag if it does)
  if (v.verdict === "SORS" && v.exitRisk < 40 && s.isOverridden) {
    return fr
      ? `Sortie forcée par override — risque calculé faible (${v.exitRisk}).`
      : `Forced exit by override — calculated risk is low (${v.exitRisk}).`;
  }

  return null;
}

/* ═══════════════════════════════════════════════ */
/*   PUBLIC API                                     */
/* ═══════════════════════════════════════════════ */

/**
 * Build a unified SubnetDecision from the engine score + verdict.
 * This is THE single derivation point. All pages consume this.
 */
export function buildSubnetDecision(
  s: UnifiedSubnetScore,
  v: SubnetVerdictData | undefined,
  fr: boolean,
): SubnetDecision {
  const conv = deriveConviction(s, v);
  const special = SPECIAL_SUBNETS[s.netuid];
  const isSystem = !!special?.isSystem;

  // ── Verdict-engine reconciliation ──
  let reconciledAction = s.action;
  if (v && !isSystem && !s.isOverridden && s.depegProbability < 50 && s.delistCategory === "NORMAL") {
    if (s.action === "EXIT" && v.verdict !== "SORS") {
      reconciledAction = v.verdict === "RENTRE" ? "WATCH" : "HOLD";
    }
  }

  const pAction = derivePortfolioAction(s, reconciledAction);

  return {
    netuid: s.netuid,
    name: s.name,

    engineAction: reconciledAction,
    actionFr: isSystem ? (fr ? "SYSTÈME" : "SYSTEM") as DecisionAction : deriveActionFr(reconciledAction),
    actionEn: isSystem ? "SYSTEM" : actionLabelEn(reconciledAction),
    badgeAction: deriveBadgeAction(reconciledAction, isSystem),
    isSystem,

    portfolioAction: pAction,
    portfolioActionFr: portfolioActionLabelFr(pAction),
    portfolioActionEn: portfolioActionLabelEn(pAction),

    conviction: conv.level,
    convictionScore: conv.score,

    opp: s.opp,
    risk: s.risk,
    asymmetry: s.asymmetry,
    confidence: s.confianceScore,
    momentumScore: s.momentumScore,
    momentumLabel: s.momentumLabel,
    stability: s.stability,

    liquidityLevel: deriveLiquidity(s.healthScores.liquidityHealth),
    structureLevel: deriveStructure(s.stability, s.isOverridden),
    statusLevel: deriveStatus(s),

    signalPrincipal: deriveSignalPrincipal(s, fr),
    thesis: v?.positiveReasons?.slice(0, 3) || [],
    invalidation: v?.negativeReasons?.slice(0, 3) || [],
    conflictExplanation: deriveConflictExplanation(s, v, fr),

    isOverridden: s.isOverridden,
    dataUncertain: s.dataUncertain,
    depegProbability: s.depegProbability,
    delistCategory: s.delistCategory,
    delistScore: s.delistScore,

    score: s,
    verdict: v,
  };
}

/**
 * Build decisions for a list of subnets.
 */
export function buildAllDecisions(
  scoresList: UnifiedSubnetScore[],
  verdicts: Map<number, SubnetVerdictData>,
  fr: boolean,
): Map<number, SubnetDecision> {
  const map = new Map<number, SubnetDecision>();
  for (const s of scoresList) {
    map.set(s.netuid, buildSubnetDecision(s, verdicts.get(s.netuid), fr));
  }
  return map;
}
