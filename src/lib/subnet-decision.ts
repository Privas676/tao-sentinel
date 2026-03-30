/* ═══════════════════════════════════════════════════════ */
/*   UNIFIED SUBNET DECISION — Single Source of Truth      */
/*   Every page MUST read from this object.                */
/*   NO local re-derivation allowed.                       */
/*   v3: Verdict Engine v3 is now the PRIMARY driver.      */
/*   TaoFlute: STRICT subnet_id matching via resolver.     */
/*   Old verdict engine kept as fallback for compatibility */
/* ═══════════════════════════════════════════════════════ */

import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";
import { SPECIAL_SUBNETS } from "@/hooks/use-subnet-scores";
import type { SubnetVerdictData } from "@/hooks/use-subnet-verdict";
import type { StrategicAction } from "@/lib/strategy-subnet";
import type { VerdictV3Result, VerdictV3 } from "@/lib/verdict-engine-v3";
import { actionLabelFr, actionLabelEn } from "@/lib/strategy-colors";
import {
  resolveTaoFluteStatus,
  taoFluteLabel,
  taoFluteBlockedLabel,
  taoFluteRawBlockedLabel,
  type TaoFluteResolvedStatus,
  type TaoFluteSeverity,
} from "@/lib/taoflute-resolver";
import {
  type LayeredDecision,
  type SocialLayerInput,
  buildCanonicalLayer,
  buildTaoFluteLayer,
  buildTaoStatsLayer,
  buildSocialLayer,
  fuseDecision,
} from "@/lib/decision-fusion";
import {
  computeOfficialDeregRisk,
  extractDeregInputFromPayload,
} from "@/lib/canonical-dereg";
import { DEPEG_PRIORITY_MANUAL, HIGH_RISK_NEAR_DELIST_MANUAL } from "@/lib/delist-risk";

/* ── Types ── */

export type FinalAction = "ENTRER" | "SURVEILLER" | "SORTIR" | "ÉVITER" | "SYSTÈME";

export type DecisionAction = "ENTRER" | "RENFORCER" | "ATTENDRE" | "SURVEILLER" | "SORTIR" | "ÉVITER" | "SYSTÈME" | "SYSTEM";

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
  badgeAction: "RENTRE" | "SORS" | "RENFORCER" | "HOLD" | "SURVEILLER" | "ATTENDRE" | "SYSTEME" | "EVITER";

  /* ── System subnet flag ── */
  isSystem: boolean;

  /* ── Decision transparency ── */
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

  /* ── TaoFlute resolved status (STRICT subnet_id matching) ── */
  taoFluteStatus: TaoFluteResolvedStatus;

  /* ── Raw references for deep-dive ── */
  score: UnifiedSubnetScore;
  verdict?: SubnetVerdictData;

  /* ── v3 verdict (primary driver when available) ── */
  verdictV3?: VerdictV3Result;

  /* ── 4-layer fusion decision (canonical, taoflute, taostats, social) ── */
  layeredDecision?: LayeredDecision;

  /* ── Market data quality / degraded mode indicators ── */
  hasMarketData: boolean;
  degradedDecisionMode: boolean;
  marketSourceStatus: "full" | "fallback" | "missing";
};

/* ── Public helpers for UI consistency ── */

/** Returns true if the action is an exit/avoid (SORTIR or ÉVITER) */
export function isExitAction(fa: FinalAction): boolean {
  return fa === "SORTIR" || fa === "ÉVITER";
}

/** Canonical color for a FinalAction */
export function finalActionColor(fa: FinalAction): string {
  switch (fa) {
    case "ENTRER": return "hsl(145,65%,48%)";
    case "SURVEILLER": return "hsl(38,60%,50%)";
    case "SORTIR": return "hsl(4,80%,50%)";
    case "ÉVITER": return "hsl(4,80%,40%)";
    case "SYSTÈME": return "hsl(210,60%,55%)";
  }
}

/** Canonical icon for a FinalAction */
export function finalActionIcon(fa: FinalAction): string {
  switch (fa) {
    case "ENTRER": return "🟢";
    case "SURVEILLER": return "👁";
    case "SORTIR": return "🔴";
    case "ÉVITER": return "⛔";
    case "SYSTÈME": return "🔷";
  }
}

/** Canonical label for a FinalAction */
export function finalActionLabel(fa: FinalAction, fr: boolean): string {
  if (fr) {
    switch (fa) {
      case "ENTRER": return "ENTRER";
      case "SURVEILLER": return "SURVEILLER";
      case "SORTIR": return "SORTIR";
      case "ÉVITER": return "ÉVITER";
      case "SYSTÈME": return "SYSTÈME";
    }
  }
  switch (fa) {
    case "ENTRER": return "ENTER";
    case "SURVEILLER": return "MONITOR";
    case "SORTIR": return "EXIT";
    case "ÉVITER": return "AVOID";
    case "SYSTÈME": return "SYSTEM";
  }
}

/* ── Derivation helpers (PRIVATE — only used here) ── */

function deriveConvictionFromV3(v3: VerdictV3Result): { level: ConvictionLevel; score: number } {
  const score = v3.confidence;
  const level = v3.conviction === "HIGH" ? "HIGH" : v3.conviction === "MEDIUM" ? "MEDIUM" : "LOW";
  return { level, score };
}

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

function deriveRawSignalFromV3(v3: VerdictV3Result): RawSignal {
  // V3 gives us much more nuanced info
  if (v3.verdict === "ENTER") return "opportunity";
  if (v3.verdict === "SORTIR" || v3.verdict === "NON_INVESTISSABLE") return "exit";
  // For SURVEILLER: check if it was blocked from ENTER
  if (v3.isBlocked) return "opportunity";
  return "neutral";
}

function deriveRawSignal(s: UnifiedSubnetScore, v?: SubnetVerdictData): RawSignal {
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
 * Compute block reasons from V3 verdict blocks.
 */
function deriveBlockReasonsFromV3(v3: VerdictV3Result, s: UnifiedSubnetScore, fr = true): string[] {
  const reasons: string[] = [];
  // V3 blocks are explicit
  for (const b of v3.blocks) {
    reasons.push(b.message);
  }
  // Add protection overrides from the scoring layer
  if (s.isOverridden) reasons.push(fr ? "Override de protection actif" : "Protection override active");
  if (s.depegProbability >= 50) reasons.push(fr ? `Risque depeg ${s.depegProbability}%` : `Depeg risk ${s.depegProbability}%`);
  if (s.delistCategory === "DEPEG_PRIORITY") reasons.push(fr ? "Priorité delist/depeg" : "Delist/depeg priority");
  return reasons;
}

function deriveBlockReasons(s: UnifiedSubnetScore, v?: SubnetVerdictData, fr = true): string[] {
  const reasons: string[] = [];
  if (s.isOverridden) reasons.push(fr ? "Override de protection actif" : "Protection override active");
  if (s.depegProbability >= 50) reasons.push(fr ? `Risque depeg ${s.depegProbability}%` : `Depeg risk ${s.depegProbability}%`);
  if (s.delistCategory === "DEPEG_PRIORITY") reasons.push(fr ? "Priorité delist/depeg" : "Delist/depeg priority");
  if (s.delistCategory === "HIGH_RISK_NEAR_DELIST") reasons.push(fr ? "Structure fragile — surveillance" : "Fragile structure — monitoring");
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
 * Map VerdictV3 to FinalAction.
 * In degraded mode (no market data), NON_INVESTISSABLE is softened to
 * SURVEILLER unless a confirmed critical blocker is present.
 */
function v3ToFinalAction(v3Verdict: VerdictV3, degraded = false, hasCriticalBlock = false): FinalAction {
  switch (v3Verdict) {
    case "ENTER": return "ENTRER";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORTIR";
    case "DONNÉES_INSTABLES": return "SURVEILLER";
    case "NON_INVESTISSABLE": return (degraded && !hasCriticalBlock) ? "SURVEILLER" : "ÉVITER";
    case "SYSTÈME": return "SYSTÈME";
  }
}

/**
 * Returns true if there is a CONFIRMED critical blocker that does NOT
 * depend on market data quality (i.e., real even when Taostats is 429).
 * In degraded mode, auto-computed DEPEG_PRIORITY from zeroed market data
 * is NOT considered a confirmed blocker — only TaoFlute priority and
 * manually-listed subnets count.
 */
function hasConfirmedCriticalBlocker(s: UnifiedSubnetScore, tf: TaoFluteResolvedStatus, degraded = false): boolean {
  // TaoFlute PRIORITY is always a hard blocker (regardless of degraded mode)
  if (tf.taoflute_severity === "priority") return true;
  // Depeg probability from the state machine (based on manual lists, not market data)
  // Only count as critical if NOT in degraded mode OR if subnet is in the top-3 manual list
  if (s.depegProbability >= 50) {
    if (degraded) {
      // In degraded mode, only the top-3 DEPEG_PRIORITY_MANUAL subnets have confirmed depeg
      return DEPEG_PRIORITY_MANUAL.slice(0, 3).includes(s.netuid);
    }
    return true;
  }
  // DEPEG_PRIORITY category from auto-scoring
  if (s.delistCategory === "DEPEG_PRIORITY") {
    if (degraded) {
      // In degraded mode, auto-computed DEPEG_PRIORITY is unreliable (zeroed data artifact)
      // Only count as critical if subnet is in the DEPEG_PRIORITY manual list (not just HIGH_RISK)
      return DEPEG_PRIORITY_MANUAL.includes(s.netuid);
    }
    return true;
  }
  return false;
}

/**
 * THE SINGLE AUTHORITATIVE DECISION FUNCTION — V3 PRIMARY.
 *
 * Priority rules (strict order):
 * 1. System subnet → SYSTÈME
 * 2. Protection override / depeg / deregistration → SORTIR (hard safety, overrides even v3)
 * 3. V3 verdict (if available) → mapped to FinalAction
 * 4. Fallback: old verdict + engine logic (backward compat)
 *
 * Protection layer ALWAYS overrides v3 for safety (depeg, delist, override).
 * V3 provides the analytical decision; protection provides the safety floor.
 */
function deriveFinalAction(
  s: UnifiedSubnetScore,
  v: SubnetVerdictData | undefined,
  v3: VerdictV3Result | undefined,
  isSystem: boolean,
  tf: TaoFluteResolvedStatus,
  degraded: boolean = false,
): FinalAction {
  // 1. System
  if (isSystem) return "SYSTÈME";

  const criticalBlock = hasConfirmedCriticalBlocker(s, tf, degraded);

  // 2. Hard protection overrides
  // DEGRADED MODE: don't early-return for auto-computed overrides — let V3 promotion logic evaluate
  // Only confirmed critical blockers force ÉVITER; others fall through to V3 block
  if (s.isOverridden) {
    if (degraded && !criticalBlock) {
      // fall through to V3 block for promotion evaluation
    } else {
      return "ÉVITER";
    }
  }
  if (s.systemStatus === "DEPEG" || s.systemStatus === "ZONE_CRITIQUE" || s.systemStatus === "DEREGISTRATION") {
    if (degraded && !criticalBlock) {
      // fall through to V3 block for promotion evaluation
    } else {
      return "ÉVITER";
    }
  }
  if (s.depegProbability >= 50) return "SORTIR";

  // R2: TaoFlute PRIORITY → guardrail_active = true → force EXIT (always, even degraded)
  if (tf.taoflute_severity === "priority") return "ÉVITER";

  // Only use delistCategory for non-TaoFlute subnets (auto-computed)
  // DEGRADED MODE: auto-computed DEPEG_PRIORITY from zeroed market data is unreliable
  // In degraded mode, do NOT early-return here — let subnets flow through to V3 block
  // where the promotion logic can evaluate momentum/stability for potential ENTRER
  if (s.delistCategory === "DEPEG_PRIORITY" && !tf.taoflute_match) {
    if (!degraded) return "ÉVITER";
    // degraded: fall through to V3 block (will be capped at SURVEILLER minimum)
  }

  // R3: TaoFlute WATCH → cap at SURVEILLER by default
  const isWatch = tf.taoflute_severity === "watch";
  if (isWatch) {
    if (s.risk >= 75) return "SORTIR";
  }

  // 2b. HIGH_RISK_NEAR_DELIST from auto-scoring (non-TaoFlute subnets only)
  // In degraded mode, do NOT early-return — let promotion logic evaluate
  if (s.delistCategory === "HIGH_RISK_NEAR_DELIST" && !tf.taoflute_match) {
    if (!degraded) {
      if (s.depegProbability >= 50 || s.risk >= 70) return "SORTIR";
    }
    // degraded: fall through to V3 block
  }

  // 3. V3 verdict — PRIMARY analytical decision (when available)
  if (v3) {
    let v3Action = v3ToFinalAction(v3.verdict, degraded, criticalBlock);

    // If v3 says ENTER, apply additional safety guards from the scoring layer
    // DEGRADED MODE: relax thresholds since risk/opp scores are inflated/deflated
    // from zeroed market data — use structural thresholds only
    if (v3Action === "ENTRER") {
      if (degraded) {
        // In degraded mode, only block ENTER for very high risk or confirmed blockers
        if (criticalBlock || s.risk >= 80 || s.confianceScore < 10) v3Action = "SURVEILLER";
      } else {
        if (s.risk >= 50 || s.opp < 20 || s.confianceScore < 30) v3Action = "SURVEILLER";
      }
    }

    // DEGRADED MODE: cap SORTIR to SURVEILLER unless confirmed blocker
    // Risk threshold raised because risk scores are inflated from missing data
    if (degraded && v3Action === "SORTIR" && !criticalBlock) {
      v3Action = "SURVEILLER";
    }

    // DEGRADED MODE ABSOLUTE GUARD: never produce ÉVITER without critical blocker
    if (degraded && v3Action === "ÉVITER" && !criticalBlock) {
      v3Action = "SURVEILLER";
    }

    // DEGRADED MODE PROMOTION: allow ENTRER when V3 is SURVEILLER but subnet has
    // strong momentum and no critical blocker. In degraded mode, V3 can't produce
    // ENTER because derived scores are corrupted from zeroed market data.
    // We use the engine-level momentum + structure as a proxy for entry quality.
    if (degraded && v3Action === "SURVEILLER" && !criticalBlock && !isWatch) {
      const hasStrongMomentum = s.momentumScore >= 55;
      const hasDecentStructure = s.stability >= 25 || s.momentumScore >= 70;
      const notInRiskList = !DEPEG_PRIORITY_MANUAL.includes(s.netuid) &&
        !HIGH_RISK_NEAR_DELIST_MANUAL.includes(s.netuid);
      // In degraded mode, isOverridden may be a false positive from auto-computed data
      // Only block promotion if the override is NOT from market-data-dependent flags
      const overrideBlocks = criticalBlock; // already checked above
      if (hasStrongMomentum && hasDecentStructure && notInRiskList && !overrideBlocks) {
        v3Action = "ENTRER";
      }
    }

    // R3: TaoFlute WATCH cap
    if (isWatch) {
      if (v3Action === "ENTRER") v3Action = "SURVEILLER";
      if (v3Action === "SORTIR" && s.risk < 70 && s.depegProbability < 40) v3Action = "SURVEILLER";
    }

    return v3Action;
  }

  // 4. FALLBACK: old verdict engine (backward compat)
  if (v && v.verdict === "SORS") {
    if (degraded && !criticalBlock) return "SURVEILLER";
    if (isWatch && s.risk < 70 && s.depegProbability < 40) return "SURVEILLER";
    return "SORTIR";
  }
  if (s.action === "EXIT" && (!v || v.verdict !== "RENTRE")) {
    if (degraded && !criticalBlock) return "SURVEILLER";
    if (isWatch && s.risk < 70 && s.depegProbability < 40) return "SURVEILLER";
    return "SORTIR";
  }

  // R3: TaoFlute WATCH — cap fallback to SURVEILLER
  if (isWatch) return "SURVEILLER";

  if (v && v.verdict === "RENTRE" && s.action !== "EXIT") {
    if (s.risk < 50 && s.opp >= 20 && s.confianceScore >= 30) return "ENTRER";
  }
  if (s.action === "ENTER" && (!v || v.verdict !== "SORS")) {
    if (s.risk < 50 && s.opp >= 20 && s.confianceScore >= 30) return "ENTRER";
  }

  return "SURVEILLER";
}

function finalActionToActionFr(fa: FinalAction): DecisionAction {
  switch (fa) {
    case "ENTRER": return "ENTRER";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORTIR";
    case "ÉVITER": return "ÉVITER";
    case "SYSTÈME": return "SYSTÈME";
  }
}

function finalActionToActionEn(fa: FinalAction): string {
  switch (fa) {
    case "ENTRER": return "ENTER";
    case "SURVEILLER": return "MONITOR";
    case "SORTIR": return "EXIT";
    case "ÉVITER": return "AVOID";
    case "SYSTÈME": return "SYSTEM";
  }
}

function finalActionToBadge(fa: FinalAction): SubnetDecision["badgeAction"] {
  switch (fa) {
    case "ENTRER": return "RENTRE";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORS";
    case "ÉVITER": return "EVITER";
    case "SYSTÈME": return "SYSTEME";
  }
}

function finalActionToEngineAction(fa: FinalAction): StrategicAction {
  switch (fa) {
    case "ENTRER": return "ENTER";
    case "SURVEILLER": return "WATCH";
    case "SORTIR": return "EXIT";
    case "ÉVITER": return "EXIT";
    case "SYSTÈME": return "HOLD";
  }
}

function derivePortfolioAction(s: UnifiedSubnetScore, fa: FinalAction, v3?: VerdictV3Result): PortfolioAction {
  // Portfolio action MUST be coherent with finalAction — strict mapping
  // ÉVITER → always SORTIR (block/exit)
  // SORTIR → SORTIR
  // SURVEILLER → CONSERVER (or REDUIRE if risk high)
  // ENTRER → RENFORCER
  if (fa === "ÉVITER") return "SORTIR";
  if (fa === "SORTIR") return "SORTIR";
  if (fa === "SYSTÈME") return "CONSERVER";
  if (fa === "ENTRER") return "RENFORCER";
  // SURVEILLER: check for risk degradation
  if (s.risk > 65 || s.depegProbability >= 40) return "REDUIRE";
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
 * Build the main signal text — uses V3 primary reason when available.
 */
function deriveSignalPrincipal(s: UnifiedSubnetScore, fa: FinalAction, rawSignal: RawSignal, isBlocked: boolean, v3: VerdictV3Result | undefined, fr: boolean): string {
  const special = SPECIAL_SUBNETS[s.netuid];
  if (special?.isSystem) return fr ? "Infrastructure réseau" : "Network infrastructure";
  if (s.isOverridden) return s.overrideReasons[0] || (fr ? "Zone critique" : "Critical zone");
  if (s.depegProbability >= 50) return `Depeg ${s.depegProbability}%`;
  // For TaoFlute WATCH subnets: DON'T crush market signal, just note external watch
  // For DEPEG_PRIORITY: keep strong warning
  if (s.delistCategory === "DEPEG_PRIORITY") return fr ? "Risque delist critique" : "Critical delist risk";
  // For non-NORMAL but NOT depeg priority: let V3/market signal through instead of blanket "Risque delist"

  // V3 primary reason is the most informative
  if (v3) {
    return v3.primaryReason.text;
  }

  if (rawSignal === "opportunity" && fa !== "ENTRER" && isBlocked) {
    return fr ? "Opportunité bloquée par garde-fous" : "Opportunity blocked by safety guards";
  }
  if (fa === "ENTRER" && s.opp > 60) return fr ? "Forte opportunité" : "Strong opportunity";
  if (fa === "SORTIR") return fr ? "Signal de sortie" : "Exit signal";
  if (s.momentumScore >= 70) return fr ? "Momentum haussier" : "Bullish momentum";
  if (s.risk > 60) return fr ? "Risque élevé" : "High risk";
  return fr ? "Stable" : "Stable";
}

function derivePrimaryReason(s: UnifiedSubnetScore, fa: FinalAction, rawSignal: RawSignal, blockReasons: string[], v3: VerdictV3Result | undefined, fr: boolean): string {
  if (fa === "SYSTÈME") return fr ? "Subnet système — infrastructure réseau" : "System subnet — network infrastructure";
  if (fa === "SORTIR" && s.isOverridden) return s.overrideReasons[0] || (fr ? "Override de protection" : "Protection override");
  if (fa === "SORTIR" && s.depegProbability >= 50) return fr ? `Risque de depeg à ${s.depegProbability}%` : `Depeg risk at ${s.depegProbability}%`;

  // V3 provides explicit primary reason
  if (v3) return v3.primaryReason.text;

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
  blockReasons: string[], v3: VerdictV3Result | undefined, v?: SubnetVerdictData, fr = true,
): string | null {
  // V3 blocks give explicit conflict information
  if (v3 && v3.isBlocked && v3.blocks.length > 0) {
    const blocksStr = v3.blocks.slice(0, 3).map(b => b.message).join(", ");
    return fr
      ? `Signal bloqué par : ${blocksStr}`
      : `Signal blocked by: ${blocksStr}`;
  }

  // Show conflict when raw signal is positive but action is not ENTRER
  if (rawSignal === "opportunity" && fa !== "ENTRER") {
    if (blockReasons.length > 0) {
      const blocksStr = blockReasons.slice(0, 3).join(", ");
      return fr
        ? `Signal brut positif mais non exécutable. Bloqué par : ${blocksStr}`
        : `Raw signal positive but not actionable. Blocked by: ${blocksStr}`;
    }
    return fr
      ? "Signal brut positif mais conditions insuffisantes pour une entrée"
      : "Raw signal positive but insufficient conditions for entry";
  }

  // Show conflict when verdict and engine disagree (old engine fallback)
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
 * Build a unified SubnetDecision from the engine score + verdicts.
 * V3 verdict is the PRIMARY driver when available.
 * This is THE single derivation point. All pages consume this.
 */
export function buildSubnetDecision(
  s: UnifiedSubnetScore,
  v: SubnetVerdictData | undefined,
  v3: VerdictV3Result | undefined,
  fr: boolean,
  tfStatus?: TaoFluteResolvedStatus,
  socialInput?: SocialLayerInput | null,
): SubnetDecision {
  const special = SPECIAL_SUBNETS[s.netuid];
  const isSystem = !!special?.isSystem;
  const degraded = !!s.marketDataDegraded;

  // ── Resolve TaoFlute status (strict subnet_id matching) ──
  const tf = tfStatus ?? resolveTaoFluteStatus(s.netuid);

  // ── Determine market data status ──
  const hasMarketData = !degraded;
  const marketSourceStatus: SubnetDecision["marketSourceStatus"] = degraded ? "fallback" : "full";

  // ── AUTHORITATIVE FINAL ACTION — V3 primary, protection overrides, TaoFlute guardrails ──
  const finalAction = deriveFinalAction(s, v, v3, isSystem, tf, degraded);
  const reconciledAction = finalActionToEngineAction(finalAction);

  // ── Conviction — prefer V3 ──
  const conv = v3 ? deriveConvictionFromV3(v3) : deriveConviction(s, v);

  // ── Decision transparency — prefer V3 ──
  const rawSignal = v3 ? deriveRawSignalFromV3(v3) : deriveRawSignal(s, v);
  let blockReasons = v3 ? deriveBlockReasonsFromV3(v3, s, fr) : deriveBlockReasons(s, v, fr);

  // R2/R3: Add TaoFlute block reasons
  if (tf.taoflute_severity === "priority") {
    blockReasons = [taoFluteBlockedLabel(fr), ...blockReasons.filter(r => !r.includes("TaoFlute") && !r.includes("delist"))];
  } else if (tf.taoflute_severity === "watch" && rawSignal === "opportunity") {
    blockReasons = [taoFluteRawBlockedLabel(fr), ...blockReasons];
  }

  const isBlocked = v3 ? (v3.isBlocked || (rawSignal === "opportunity" && finalAction !== "ENTRER")) : (rawSignal === "opportunity" && finalAction !== "ENTRER");

  // R4: Primary reason must reflect final_action, not raw_signal
  let primaryReason = derivePrimaryReason(s, finalAction, rawSignal, blockReasons, v3, fr);
  if (tf.taoflute_severity === "priority" && finalAction === "SORTIR") {
    primaryReason = taoFluteLabel(tf, fr);
  }

  const pAction = derivePortfolioAction(s, finalAction, v3);

  // ── Thesis & invalidation — V3 provides richer data ──
  const thesis = v3
    ? v3.secondaryReasons.map(r => r.text)
    : (v?.positiveReasons?.slice(0, 3) || []);
  const invalidation = v3
    ? v3.riskFlags.map(r => r.text)
    : (v?.negativeReasons?.slice(0, 3) || []);

  // R5/R6: Adjust delistScore based on TaoFlute
  let effectiveDelistScore = s.delistScore;
  if (tf.taoflute_severity === "priority") effectiveDelistScore = Math.max(effectiveDelistScore, 85);
  else if (tf.taoflute_severity === "watch") effectiveDelistScore = Math.max(effectiveDelistScore, 60);

  // ── 4-Layer Fusion Decision ──
  const rawPayload = (s as any).rawPayload ?? null;
  const totalSubnets = 128; // approximate; could be dynamic
  const deregInput = extractDeregInputFromPayload(s.netuid, rawPayload, totalSubnets);
  const deregRisk = computeOfficialDeregRisk(deregInput);
  const canonicalLayer = buildCanonicalLayer(deregRisk, null);
  const taoFluteLayer = buildTaoFluteLayer(tf, null);

  // TaoStats layer from health scores
  const flowScore = Math.round(
    ((s.healthScores.volumeHealth ?? 50) + (s.healthScores.activityHealth ?? 50)) / 2
  );
  const structScore = Math.round(s.stability);
  const execScore = Math.round(s.healthScores.liquidityHealth ?? 50);
  const taostatsLayer = buildTaoStatsLayer({
    liquidityHealth: s.healthScores.liquidityHealth ?? 50,
    flowScore,
    structureScore: structScore,
    momentumScore: s.momentumScore,
    executionScore: execScore,
    timestamp: null,
  });

  // Social layer — populated from useSocialSubnetScores when available
  const socialLayer = buildSocialLayer(socialInput ?? null);

  const layeredDecision = fuseDecision(
    s.netuid, canonicalLayer, taoFluteLayer, taostatsLayer, socialLayer, finalAction, fr,
  );

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
    confidence: degraded ? Math.max(10, s.confianceScore - 20) : s.confianceScore,
    momentumScore: s.momentumScore,
    momentumLabel: s.momentumLabel,
    stability: s.stability,

    liquidityLevel: deriveLiquidity(s.healthScores.liquidityHealth),
    structureLevel: deriveStructure(s.stability, s.isOverridden),
    statusLevel: deriveStatus(s),

    signalPrincipal: deriveSignalPrincipal(s, finalAction, rawSignal, isBlocked, v3, fr),
    thesis,
    invalidation,
    conflictExplanation: deriveConflictExplanation(s, finalAction, rawSignal, blockReasons, v3, v, fr),

    isOverridden: s.isOverridden,
    dataUncertain: s.dataUncertain,
    depegProbability: s.depegProbability,
    delistCategory: s.delistCategory,
    delistScore: effectiveDelistScore,

    taoFluteStatus: tf,

    score: s,
    verdict: v,
    verdictV3: v3,
    layeredDecision,

    hasMarketData,
    degradedDecisionMode: degraded,
    marketSourceStatus,
  };
}

/**
 * Build decisions for a list of subnets.
 * Accepts both old verdicts (fallback) and V3 verdicts (primary).
 * TaoFlute statuses are resolved per subnet_id (strict matching).
 */
export function buildAllDecisions(
  scoresList: UnifiedSubnetScore[],
  verdicts: Map<number, SubnetVerdictData>,
  verdictsV3: Map<number, VerdictV3Result>,
  fr: boolean,
  taoFluteStatuses?: Map<number, TaoFluteResolvedStatus>,
  socialScores?: Map<number, SocialLayerInput>,
): Map<number, SubnetDecision> {
  const map = new Map<number, SubnetDecision>();
  for (const s of scoresList) {
    const tf = taoFluteStatuses?.get(s.netuid);
    const social = socialScores?.get(s.netuid) ?? null;
    map.set(s.netuid, buildSubnetDecision(s, verdicts.get(s.netuid), verdictsV3.get(s.netuid), fr, tf, social));
  }
  return map;
}
