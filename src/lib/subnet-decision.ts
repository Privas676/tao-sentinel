/* ═══════════════════════════════════════════════════════ */
/*   UNIFIED SUBNET DECISION — Single Source of Truth      */
/*   Every page MUST read from this object.                */
/*   NO local re-derivation allowed.                       */
/*   v2: Eliminated reconciliation — one authoritative path */
/* ═══════════════════════════════════════════════════════ */

import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import type { SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import type { StrategicAction } from "@/lib/strategy-subnet";
import { actionLabelFr, actionLabelEn } from "@/lib/strategy-colors";

/* ── Types ── */

export type FinalAction = "ENTRER" | "SURVEILLER" | "SORTIR" | "SYSTÈME";

export type DecisionAction = "ENTRER" | "RENFORCER" | "ATTENDRE" | "SURVEILLER" | "SORTIR" | "SYSTÈME" | "SYSTEM";

export type ConvictionLevel = "HIGH" | "MEDIUM" | "LOW";
export type LiquidityLevel = "HIGH" | "MEDIUM" | "LOW";
export type StructureLevel = "HEALTHY" | "FRAGILE" | "CONCENTRATED";
export type StatusLevel = "OK" | "WATCH" | "DANGER";

export type RawSignal = "opportunity" | "neutral" | "exit";

/** Portfolio-specific action for positions already held */
export type PortfolioAction = "RENFORCER" | "CONSERVER" | "REDUIRE" | "SORTIR";

/**
 * The single decision object per subnet.
 * All pages consume this — no local re-derivation.
 */
export type SubnetDecision = {
  netuid: number;
  name: string;

  /* ── Final unified action — THE authoritative verdict ── */
  finalAction: FinalAction;

  /* ── Legacy engine action (from UnifiedSubnetScore) — kept for backward compat ── */
  engineAction: StrategicAction;

  /* ── Unified decision label (French) ── */
  actionFr: DecisionAction;
  actionEn: string;

  /* ── ActionBadge key for the ActionBadge component ── */
  badgeAction: "RENTRE" | "SORS" | "RENFORCER" | "HOLD" | "SURVEILLER" | "ATTENDRE" | "SYSTEME";

  /* ── System subnet flag ── */
  isSystem: boolean;

  /* ── Decision transparency — NEW ── */
  rawSignal: RawSignal;
  isBlocked: boolean;
  blockReasons: string[];
  primaryReason: string;

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

function deriveRawSignal(s: UnifiedSubnetScore, v?: SubnetVerdictData): RawSignal {
  // What the raw metrics suggest BEFORE safety guards
  if (v) {
    if (v.entryScore >= 55) return "opportunity";
    if (v.exitRisk >= 55) return "exit";
    return "neutral";
  }
  if (s.opp > 55 && s.momentumScore >= 40) return "opportunity";
  if (s.risk > 60 || s.action === "EXIT") return "exit";
  return "neutral";
}

/**
 * Compute block reasons — why the raw signal might not become the final action.
 */
function deriveBlockReasons(s: UnifiedSubnetScore, v?: SubnetVerdictData, fr = true): string[] {
  const reasons: string[] = [];
  if (s.isOverridden) reasons.push(fr ? "Override de protection actif" : "Protection override active");
  if (s.depegProbability >= 50) reasons.push(fr ? `Risque depeg ${s.depegProbability}%` : `Depeg risk ${s.depegProbability}%`);
  if (s.delistCategory === "DEPEG_PRIORITY") reasons.push(fr ? "Priorité delist/depeg" : "Delist/depeg priority");
  if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") reasons.push(fr ? "Proche délistage" : "Near delist");
  if (s.systemStatus === "DEPEG") reasons.push(fr ? "Statut DEPEG" : "DEPEG status");
  if (s.systemStatus === "ZONE_CRITIQUE") reasons.push(fr ? "Zone critique" : "Critical zone");
  if (s.risk > 65) reasons.push(fr ? `Risque structurel élevé (${s.risk})` : `High structural risk (${s.risk})`);
  if (v && v.dataReliability === "stale") reasons.push(fr ? "Données obsolètes" : "Stale data");
  if (v && v.dataReliability === "suspect") reasons.push(fr ? "Données suspectes" : "Suspect data");
  if (s.confianceScore < 30) reasons.push(fr ? `Confiance données ${s.confianceScore}%` : `Data confidence ${s.confianceScore}%`);
  if (s.healthScores.liquidityHealth < 20) reasons.push(fr ? "Liquidité critique" : "Critical liquidity");
  return reasons;
}

/**
 * THE SINGLE AUTHORITATIVE DECISION FUNCTION.
 * Priority rules (strict order):
 * 1. System subnet → SYSTÈME
 * 2. Protection override / depeg / deregistration → SORTIR
 * 3. Verdict engine SORS → SORTIR
 * 4. Engine EXIT (not overridden by verdict) → SORTIR
 * 5. Verdict engine RENTRE + no block → ENTRER
 * 6. Everything else → SURVEILLER
 */
function deriveFinalAction(
  s: UnifiedSubnetScore,
  v: SubnetVerdictData | undefined,
  isSystem: boolean,
): FinalAction {
  // 1. System
  if (isSystem) return "SYSTÈME";

  // 2. Hard protection overrides — always SORTIR
  if (s.isOverridden) return "SORTIR";
  if (s.systemStatus === "DEPEG" || s.systemStatus === "ZONE_CRITIQUE" || s.systemStatus === "DEREGISTRATION") return "SORTIR";
  if (s.depegProbability >= 50) return "SORTIR";
  if (s.delistCategory === "DEPEG_PRIORITY") return "SORTIR";

  // 3. If verdict engine says SORS → SORTIR
  if (v && v.verdict === "SORS") return "SORTIR";

  // 4. If strategic engine says EXIT and no verdict contradicts → SORTIR
  if (s.action === "EXIT" && (!v || v.verdict !== "RENTRE")) return "SORTIR";

  // 4b. HIGH_RISK_NEAR_DELIST — NEVER allow ENTRER, force SURVEILLER or SORTIR
  //     If depeg probability is significant (>=30%) → SORTIR, otherwise → SURVEILLER
  if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") {
    if (s.depegProbability >= 30 || s.risk >= 60) return "SORTIR";
    return "SURVEILLER";
  }

  // 5. If verdict engine says RENTRE and no blocking conditions → ENTRER
  if (v && v.verdict === "RENTRE" && s.action !== "EXIT") {
    // Additional sanity: entry only if risk is manageable
    if (s.risk < 65 && s.confianceScore >= 30) return "ENTRER";
    // Blocked by guards — fall through to SURVEILLER
  }

  // 5b. Engine says ENTER with no verdict contradicting
  if (s.action === "ENTER" && (!v || v.verdict !== "SORS")) {
    if (s.risk < 65 && s.confianceScore >= 30) return "ENTRER";
  }

  // 6. Everything else → SURVEILLER
  return "SURVEILLER";
}

function finalActionToActionFr(fa: FinalAction): DecisionAction {
  switch (fa) {
    case "ENTRER": return "ENTRER";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORTIR";
    case "SYSTÈME": return "SYSTÈME";
  }
}

function finalActionToActionEn(fa: FinalAction): string {
  switch (fa) {
    case "ENTRER": return "ENTER";
    case "SURVEILLER": return "MONITOR";
    case "SORTIR": return "EXIT";
    case "SYSTÈME": return "SYSTEM";
  }
}

function finalActionToBadge(fa: FinalAction): SubnetDecision["badgeAction"] {
  switch (fa) {
    case "ENTRER": return "RENTRE";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORS";
    case "SYSTÈME": return "SYSTEME";
  }
}

function finalActionToEngineAction(fa: FinalAction): StrategicAction {
  switch (fa) {
    case "ENTRER": return "ENTER";
    case "SURVEILLER": return "WATCH";
    case "SORTIR": return "EXIT";
    case "SYSTÈME": return "HOLD";
  }
}

function derivePortfolioAction(s: UnifiedSubnetScore, fa: FinalAction): PortfolioAction {
  if (fa === "SORTIR") return "SORTIR";
  if (s.risk > 65 || s.depegProbability >= 40) return "REDUIRE";
  if (fa === "ENTRER") return "RENFORCER";
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
function deriveSignalPrincipal(s: UnifiedSubnetScore, fa: FinalAction, rawSignal: RawSignal, isBlocked: boolean, fr: boolean): string {
  const special = SPECIAL_SUBNETS[s.netuid];
  if (special?.isSystem) return fr ? "Infrastructure réseau" : "Network infrastructure";
  if (s.isOverridden) return s.overrideReasons[0] || (fr ? "Zone critique" : "Critical zone");
  if (s.depegProbability >= 50) return `Depeg ${s.depegProbability}%`;
  if (s.delistCategory !== "NORMAL") return fr ? "Risque delist" : "Delist risk";

  // NEW: If raw signal is opportunity but final action is not ENTRER, show blocked message
  if (rawSignal === "opportunity" && fa !== "ENTRER" && isBlocked) {
    return fr ? "Opportunité bloquée par garde-fous" : "Opportunity blocked by safety guards";
  }

  if (fa === "ENTRER" && s.opp > 60) return fr ? "Forte opportunité" : "Strong opportunity";
  if (fa === "SORTIR") return fr ? "Signal de sortie" : "Exit signal";
  if (s.momentumScore >= 70) return fr ? "Momentum haussier" : "Bullish momentum";
  if (s.risk > 60) return fr ? "Risque élevé" : "High risk";
  return fr ? "Stable" : "Stable";
}

function derivePrimaryReason(s: UnifiedSubnetScore, fa: FinalAction, rawSignal: RawSignal, blockReasons: string[], fr: boolean): string {
  if (fa === "SYSTÈME") return fr ? "Subnet système — infrastructure réseau" : "System subnet — network infrastructure";
  if (fa === "SORTIR" && s.isOverridden) return s.overrideReasons[0] || (fr ? "Override de protection" : "Protection override");
  if (fa === "SORTIR" && s.depegProbability >= 50) return fr ? `Risque de depeg à ${s.depegProbability}%` : `Depeg risk at ${s.depegProbability}%`;
  if (fa === "SORTIR") return fr ? "Risque structurel trop élevé" : "Structural risk too high";
  if (fa === "ENTRER") return fr ? "Conditions d'entrée réunies" : "Entry conditions met";
  if (rawSignal === "opportunity" && blockReasons.length > 0) return fr ? `Signal haussier détecté mais bloqué` : "Bullish signal detected but blocked";
  return fr ? "Setup incomplet — surveillance active" : "Incomplete setup — active monitoring";
}

/**
 * Derive conflict explanation when verdict seems contradictory.
 */
function deriveConflictExplanation(
  s: UnifiedSubnetScore, fa: FinalAction, rawSignal: RawSignal,
  blockReasons: string[], v?: SubnetVerdictData, fr = true,
): string | null {
  // Show conflict when raw signal is positive but action is not ENTRER
  if (rawSignal === "opportunity" && fa !== "ENTRER") {
    if (blockReasons.length > 0) {
      const blocksStr = blockReasons.slice(0, 3).join(", ");
      return fr
        ? `Opportunité brute détectée — non actionnable actuellement. Bloquée par : ${blocksStr}`
        : `Raw opportunity detected — not actionable currently. Blocked by: ${blocksStr}`;
    }
    return fr
      ? "Signal fort détecté mais conditions insuffisantes pour une entrée"
      : "Strong signal detected but insufficient conditions for entry";
  }

  // Show conflict when verdict and engine disagree
  if (v) {
    if (v.verdict === "SORS" && s.action !== "EXIT" && fa === "SORTIR") {
      return fr
        ? `Moteur de verdicts recommande la sortie (exitRisk ${v.exitRisk}) malgré un signal moteur différent`
        : `Verdict engine recommends exit (exitRisk ${v.exitRisk}) despite different engine signal`;
    }
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

  // ── AUTHORITATIVE FINAL ACTION — no reconciliation ambiguity ──
  const finalAction = deriveFinalAction(s, v, isSystem);
  const reconciledAction = finalActionToEngineAction(finalAction);

  // ── Decision transparency ──
  const rawSignal = deriveRawSignal(s, v);
  const blockReasons = deriveBlockReasons(s, v, fr);
  const isBlocked = rawSignal === "opportunity" && finalAction !== "ENTRER";
  const primaryReason = derivePrimaryReason(s, finalAction, rawSignal, blockReasons, fr);

  const pAction = derivePortfolioAction(s, finalAction);

  return {
    netuid: s.netuid,
    name: s.name,

    finalAction,
    engineAction: reconciledAction,
    actionFr: finalActionToActionFr(finalAction),
    actionEn: finalActionToActionEn(finalAction),
    badgeAction: finalActionToBadge(finalAction),
    isSystem,

    rawSignal,
    isBlocked,
    blockReasons,
    primaryReason,

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

    signalPrincipal: deriveSignalPrincipal(s, finalAction, rawSignal, isBlocked, fr),
    thesis: v?.positiveReasons?.slice(0, 3) || [],
    invalidation: v?.negativeReasons?.slice(0, 3) || [],
    conflictExplanation: deriveConflictExplanation(s, finalAction, rawSignal, blockReasons, v, fr),

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
