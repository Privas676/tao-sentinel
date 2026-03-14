/* ═══════════════════════════════════════════════════════════ */
/*   VERDICT ENGINE v3 — Layer C: Final Decision              */
/*   6 verdicts based on DerivedScores + Concordance.         */
/*   Every verdict is auditable: reasons, blocks, provenance. */
/*   This module has ZERO UI dependencies.                    */
/* ═══════════════════════════════════════════════════════════ */

import type { DerivedScores, ScoringResult, ProhibitionViolation } from "./derived-scores";
import type { ConcordanceResult, ConcordanceGrade } from "./source-concordance";
import type { SubnetFacts } from "./subnet-facts";
import { val } from "./subnet-facts";
import { clamp } from "./gauge-types";

/* ─── Verdict types ─── */

export type VerdictV3 =
  | "ENTER"
  | "SURVEILLER"
  | "SORTIR"
  | "DONNÉES_INSTABLES"
  | "NON_INVESTISSABLE"
  | "SYSTÈME";

export type UrgencyLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type HorizonLevel = "COURT" | "MOYEN" | "LONG";
export type ConvictionV3 = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type VerdictReason = {
  code: string;
  text: string;
  /** Which score or fact triggered this reason */
  source: string;
};

export type VerdictBlock = {
  code: string;
  message: string;
  /** The score/fact that caused the block */
  trigger: string;
};

export type VerdictV3Result = {
  netuid: number;
  name: string;

  /* ── The verdict ── */
  verdict: VerdictV3;
  verdictFr: string;
  verdictEn: string;

  /* ── Decision metadata ── */
  urgency: UrgencyLevel;
  confidence: number;       // 0-100 (how confident is the engine in this verdict)
  conviction: ConvictionV3;
  horizon: HorizonLevel;

  /* ── Reasons ── */
  primaryReason: VerdictReason;
  secondaryReasons: VerdictReason[];  // max 2
  riskFlags: VerdictReason[];         // max 3

  /* ── Blocks (why a better verdict was prevented) ── */
  isBlocked: boolean;
  blocks: VerdictBlock[];

  /* ── What to watch next ── */
  watchlist: string[];  // max 3 items

  /* ── Provenance ── */
  concordanceGrade: ConcordanceGrade;
  concordanceScore: number;
  prohibitionViolations: ProhibitionViolation[];
  engineVersion: string;

  /* ── Portfolio action ── */
  portfolioAction: "RENFORCER" | "CONSERVER" | "RÉDUIRE" | "SORTIR" | "NE_PAS_ENTRER";
};

/* ─── Constants ─── */

const ENGINE_VERSION = "v3.0";

/** Subnets that are system/infrastructure — not investable */
const SYSTEM_NETUIDS = new Set([0]);

/** Thresholds for non-investable classification */
const NON_INVESTABLE_THRESHOLDS = {
  delistRisk: 75,
  structuralFragility: 85,
  minMiners: 0,   // strictly 0 miners
  minValidators: 1, // strictly ≤1 validator
};

/* ─── Labels ─── */

function verdictLabelFr(v: VerdictV3): string {
  switch (v) {
    case "ENTER": return "ENTRER";
    case "SURVEILLER": return "SURVEILLER";
    case "SORTIR": return "SORTIR";
    case "DONNÉES_INSTABLES": return "DONNÉES INSTABLES";
    case "NON_INVESTISSABLE": return "NON INVESTISSABLE";
    case "SYSTÈME": return "SYSTÈME";
  }
}

function verdictLabelEn(v: VerdictV3): string {
  switch (v) {
    case "ENTER": return "ENTER";
    case "SURVEILLER": return "MONITOR";
    case "SORTIR": return "EXIT";
    case "DONNÉES_INSTABLES": return "UNSTABLE DATA";
    case "NON_INVESTISSABLE": return "NOT INVESTABLE";
    case "SYSTÈME": return "SYSTEM";
  }
}

/* ─── Risk flag extraction ─── */

function extractRiskFlags(scores: DerivedScores, facts: SubnetFacts): VerdictReason[] {
  const flags: VerdictReason[] = [];

  if (scores.depegRisk > 60) {
    flags.push({ code: "DEPEG_HIGH", text: `Risque depeg élevé (${scores.depegRisk}/100)`, source: "depegRisk" });
  }
  if (scores.delistRisk > 50) {
    flags.push({ code: "DELIST_RISK", text: `Risque delist (${scores.delistRisk}/100)`, source: "delistRisk" });
  }
  if (scores.structuralFragility > 70) {
    flags.push({ code: "FRAGILE_STRUCTURE", text: `Structure fragile (${scores.structuralFragility}/100)`, source: "structuralFragility" });
  }
  if (scores.concentrationRisk > 70) {
    flags.push({ code: "CONCENTRATION", text: `Concentration élevée (${scores.concentrationRisk}/100)`, source: "concentrationRisk" });
  }
  if (scores.executionQuality < 30) {
    flags.push({ code: "POOR_EXECUTION", text: `Exécution dégradée (${scores.executionQuality}/100)`, source: "executionQuality" });
  }
  if (scores.liquidityQuality < 25) {
    flags.push({ code: "LOW_LIQUIDITY", text: `Liquidité critique (${scores.liquidityQuality}/100)`, source: "liquidityQuality" });
  }
  if (scores.volatility > 75) {
    flags.push({ code: "HIGH_VOLATILITY", text: `Volatilité extrême (${scores.volatility}/100)`, source: "volatility" });
  }

  // Sort by severity (higher score values = more severe for risk metrics)
  flags.sort((a, b) => {
    const aVal = (scores as any)[a.source] ?? 0;
    const bVal = (scores as any)[b.source] ?? 0;
    // For risk scores (higher=worse), sort descending. For quality scores (lower=worse), sort ascending.
    return bVal - aVal;
  });

  return flags.slice(0, 3);
}

/* ─── Watchlist generation ─── */

function generateWatchlist(scores: DerivedScores, verdict: VerdictV3): string[] {
  const items: string[] = [];

  if (verdict === "ENTER") {
    if (scores.structuralFragility > 40) items.push("Surveiller la stabilité structurelle");
    if (scores.volatility > 50) items.push("Volatilité à surveiller");
    if (scores.liquidityQuality < 60) items.push("Profondeur liquidité limitée");
  } else if (verdict === "SURVEILLER") {
    if (scores.momentum > 60) items.push("Momentum positif — surveiller confirmation");
    if (scores.liquidityQuality < 50) items.push("Amélioration liquidité requise");
    if (scores.structuralFragility > 50) items.push("Structure à consolider");
    if (scores.sourceConcordance < 60) items.push("Concordance sources à améliorer");
  } else if (verdict === "SORTIR") {
    items.push("Surveiller stabilisation avant réentrée");
    if (scores.depegRisk > 50) items.push("Risque depeg actif");
    if (scores.delistRisk > 50) items.push("Risque delist actif");
  }

  return items.slice(0, 3);
}

/* ─── Urgency derivation ─── */

function deriveUrgency(verdict: VerdictV3, scores: DerivedScores): UrgencyLevel {
  if (verdict === "SYSTÈME" || verdict === "NON_INVESTISSABLE") return "NONE";
  if (verdict === "DONNÉES_INSTABLES") return "LOW";

  if (verdict === "SORTIR") {
    if (scores.depegRisk > 80 || scores.delistRisk > 80) return "CRITICAL";
    if (scores.depegRisk > 60 || scores.delistRisk > 60) return "HIGH";
    return "MEDIUM";
  }

  if (verdict === "ENTER") {
    if (scores.momentum > 80 && scores.marketStrength > 70) return "MEDIUM";
    return "LOW";
  }

  return "NONE";
}

/* ─── Horizon ─── */

function deriveHorizon(scores: DerivedScores): HorizonLevel {
  if (scores.volatility > 70) return "COURT";
  if (scores.momentum > 60 && scores.marketStrength > 60) return "MOYEN";
  return "LONG";
}

/* ─── Conviction ─── */

function deriveConviction(scores: DerivedScores, concordance: ConcordanceResult): ConvictionV3 {
  if (concordance.score < 40) return "NONE";
  if (scores.conviction > 70 && concordance.score > 70) return "HIGH";
  if (scores.conviction > 50 && concordance.score > 55) return "MEDIUM";
  return "LOW";
}

/* ─── Portfolio action ─── */

function derivePortfolioAction(verdict: VerdictV3, scores: DerivedScores): VerdictV3Result["portfolioAction"] {
  if (verdict === "SORTIR") return "SORTIR";
  if (verdict === "DONNÉES_INSTABLES" || verdict === "NON_INVESTISSABLE" || verdict === "SYSTÈME") return "NE_PAS_ENTRER";
  if (verdict === "ENTER" && scores.conviction > 60) return "RENFORCER";
  if (verdict === "SURVEILLER" && scores.depegRisk > 50) return "RÉDUIRE";
  return "CONSERVER";
}

/* ═══════════════════════════════════════════════ */
/*   CORE VERDICT LOGIC — Priority chain           */
/* ═══════════════════════════════════════════════ */

/**
 * THE decision function. Strict priority chain:
 *
 * 1. SYSTÈME — if netuid is in system set
 * 2. NON_INVESTISSABLE — if delistRisk extreme OR structure toxic
 * 3. DONNÉES_INSTABLES — if concordance grade D or forceUnstable
 * 4. SORTIR — if structure toxic + execution toxic + risk flags
 * 5. ENTER — if momentum + market + structure + execution all OK, concordance ≥ B
 * 6. SURVEILLER — everything else
 */
export function computeVerdictV3(
  facts: SubnetFacts,
  scoring: ScoringResult,
  concordance: ConcordanceResult,
): VerdictV3Result {
  const { scores, violations, explanations } = scoring;
  const netuid = facts.netuid;
  const name = val(facts.name);

  const blocks: VerdictBlock[] = [];
  let verdict: VerdictV3;
  let primaryReason: VerdictReason;
  let secondaryReasons: VerdictReason[] = [];

  /* ── Rule 1: SYSTÈME ── */
  if (SYSTEM_NETUIDS.has(netuid)) {
    verdict = "SYSTÈME";
    primaryReason = { code: "SYSTEM_SUBNET", text: "Subnet système — infrastructure réseau", source: "netuid" };
    return buildResult(netuid, name, verdict, primaryReason, secondaryReasons, [], blocks, scores, concordance, violations);
  }

  /* ── Rule 2: NON_INVESTISSABLE ── */
  const miners = val(facts.miners);
  const validators = val(facts.validators);
  if (
    scores.delistRisk >= NON_INVESTABLE_THRESHOLDS.delistRisk ||
    scores.structuralFragility >= NON_INVESTABLE_THRESHOLDS.structuralFragility ||
    (miners <= NON_INVESTABLE_THRESHOLDS.minMiners) ||
    (validators <= NON_INVESTABLE_THRESHOLDS.minValidators && miners <= 1)
  ) {
    verdict = "NON_INVESTISSABLE";
    const reasons: string[] = [];
    if (scores.delistRisk >= 75) reasons.push(`Risque delist ${scores.delistRisk}/100`);
    if (miners <= 0) reasons.push("Aucun mineur actif");
    if (validators <= 1 && miners <= 1) reasons.push(`Validators: ${validators}, Miners: ${miners}`);
    if (scores.structuralFragility >= 85) reasons.push(`Structure toxique (${scores.structuralFragility}/100)`);
    primaryReason = { code: "NOT_INVESTABLE", text: reasons[0] || "Structure non investissable", source: "delistRisk" };
    secondaryReasons = reasons.slice(1, 3).map((r, i) => ({ code: `NI_${i}`, text: r, source: "structure" }));
    return buildResult(netuid, name, verdict, primaryReason, secondaryReasons, extractRiskFlags(scores, facts), blocks, scores, concordance, violations);
  }

  /* ── Rule 3: DONNÉES_INSTABLES ── */
  if (concordance.forceUnstable || concordance.grade === "D") {
    verdict = "DONNÉES_INSTABLES";
    const failedLabels = concordance.failedChecks.slice(0, 3).map(c => c.label);
    primaryReason = {
      code: "UNSTABLE_DATA",
      text: `Concordance ${concordance.grade} (${concordance.score}/100) — ${concordance.failedChecks.length} checks échoués`,
      source: "concordance",
    };
    secondaryReasons = failedLabels.map((l, i) => ({ code: `DATA_${i}`, text: l, source: "concordance" }));
    return buildResult(netuid, name, verdict, primaryReason, secondaryReasons, extractRiskFlags(scores, facts), blocks, scores, concordance, violations);
  }

  /* ── Rule 4: SORTIR ── */
  // Conditions: structural risk + execution risk + high overall risk
  const exitScore = computeExitScore(scores);
  if (exitScore >= 65) {
    verdict = "SORTIR";
    const reasons: VerdictReason[] = [];
    if (scores.structuralFragility > 60) reasons.push({ code: "EXIT_STRUCTURE", text: `Structure fragile (${scores.structuralFragility}/100)`, source: "structuralFragility" });
    if (scores.executionQuality < 35) reasons.push({ code: "EXIT_EXECUTION", text: `Exécution dégradée (${scores.executionQuality}/100)`, source: "executionQuality" });
    if (scores.depegRisk > 50) reasons.push({ code: "EXIT_DEPEG", text: `Risque depeg (${scores.depegRisk}/100)`, source: "depegRisk" });
    if (scores.liquidityQuality < 30) reasons.push({ code: "EXIT_LIQ", text: `Liquidité insuffisante (${scores.liquidityQuality}/100)`, source: "liquidityQuality" });
    if (scores.concentrationRisk > 60) reasons.push({ code: "EXIT_CONC", text: `Concentration élevée (${scores.concentrationRisk}/100)`, source: "concentrationRisk" });
    if (scores.delistRisk > 50) reasons.push({ code: "EXIT_DELIST", text: `Risque delist (${scores.delistRisk}/100)`, source: "delistRisk" });

    primaryReason = reasons[0] || { code: "EXIT_RISK", text: `Score de sortie élevé (${exitScore}/100)`, source: "composite" };
    secondaryReasons = reasons.slice(1, 3);

    // Check if momentum was positive (conflict explanation)
    if (scores.momentum > 55) {
      blocks.push({
        code: "MOMENTUM_OVERRIDE",
        message: `Momentum positif (${scores.momentum}/100) mais risque structurel trop élevé — sortie maintenue`,
        trigger: "momentum vs structuralFragility",
      });
    }

    return buildResult(netuid, name, verdict, primaryReason, secondaryReasons, extractRiskFlags(scores, facts), blocks, scores, concordance, violations);
  }

  /* ── Rule 5: ENTER ── */
  const entryScore = computeEntryScore(scores);
  const canEnter = concordance.allowStrongVerdict && entryScore >= 60;

  if (canEnter) {
    // Additional safety checks — blocks that prevent ENTER
    if (scores.depegRisk > 45) {
      blocks.push({ code: "DEPEG_BLOCK", message: `Risque depeg ${scores.depegRisk}/100 bloque l'entrée`, trigger: "depegRisk" });
    }
    if (scores.liquidityQuality < 35) {
      blocks.push({ code: "LIQ_BLOCK", message: `Liquidité ${scores.liquidityQuality}/100 insuffisante`, trigger: "liquidityQuality" });
    }
    if (scores.concentrationRisk > 65) {
      blocks.push({ code: "CONC_BLOCK", message: `Concentration ${scores.concentrationRisk}/100 bloque`, trigger: "concentrationRisk" });
    }

    if (blocks.length > 0) {
      // Blocked: downgrade to SURVEILLER
      verdict = "SURVEILLER";
      primaryReason = {
        code: "ENTRY_BLOCKED",
        text: `Signal d'entrée détecté (${entryScore}/100) mais bloqué par garde-fous`,
        source: "composite",
      };
      secondaryReasons = blocks.slice(0, 2).map((b, i) => ({ code: `BLOCK_${i}`, text: b.message, source: b.trigger }));
    } else {
      verdict = "ENTER";
      const reasons: VerdictReason[] = [];
      if (scores.momentum > 60) reasons.push({ code: "ENTER_MOM", text: `Momentum fort (${scores.momentum}/100)`, source: "momentum" });
      if (scores.marketStrength > 60) reasons.push({ code: "ENTER_MKT", text: `Marché solide (${scores.marketStrength}/100)`, source: "marketStrength" });
      if (scores.executionQuality > 60) reasons.push({ code: "ENTER_EXEC", text: `Bonne exécution (${scores.executionQuality}/100)`, source: "executionQuality" });
      if (scores.smartMoney > 60) reasons.push({ code: "ENTER_SM", text: `Smart money positif (${scores.smartMoney}/100)`, source: "smartMoney" });
      primaryReason = reasons[0] || { code: "ENTER_SCORE", text: `Conditions d'entrée réunies (${entryScore}/100)`, source: "composite" };
      secondaryReasons = reasons.slice(1, 3);
    }

    return buildResult(netuid, name, verdict, primaryReason, secondaryReasons, extractRiskFlags(scores, facts), blocks, scores, concordance, violations);
  }

  /* ── Rule 6: SURVEILLER (default) ── */
  verdict = "SURVEILLER";

  // Determine primary reason
  if (scores.momentum > 55 && entryScore < 60) {
    primaryReason = { code: "WATCH_PARTIAL", text: `Momentum positif mais setup incomplet (entry: ${entryScore}/100)`, source: "momentum" };
  } else if (scores.structuralFragility > 50) {
    primaryReason = { code: "WATCH_FRAGILE", text: `Structure encore fragile (${scores.structuralFragility}/100)`, source: "structuralFragility" };
  } else if (!concordance.allowStrongVerdict) {
    primaryReason = { code: "WATCH_DATA", text: `Concordance insuffisante (${concordance.grade}: ${concordance.score}/100)`, source: "concordance" };
  } else {
    primaryReason = { code: "WATCH_DEFAULT", text: "Setup incomplet — surveillance active", source: "composite" };
  }

  // Secondary reasons
  if (scores.liquidityQuality < 50) secondaryReasons.push({ code: "WATCH_LIQ", text: `Liquidité limitée (${scores.liquidityQuality}/100)`, source: "liquidityQuality" });
  if (scores.volatility > 60) secondaryReasons.push({ code: "WATCH_VOL", text: `Volatilité élevée (${scores.volatility}/100)`, source: "volatility" });
  if (scores.concentrationRisk > 50) secondaryReasons.push({ code: "WATCH_CONC", text: `Concentration (${scores.concentrationRisk}/100)`, source: "concentrationRisk" });

  return buildResult(netuid, name, verdict, primaryReason, secondaryReasons.slice(0, 2), extractRiskFlags(scores, facts), blocks, scores, concordance, violations);
}

/* ─── Composite scores for entry/exit thresholds ─── */

function computeEntryScore(s: DerivedScores): number {
  // Weighted composite: momentum-heavy, penalized by risk
  const raw =
    s.momentum * 0.30 +
    s.marketStrength * 0.20 +
    s.liquidityQuality * 0.15 +
    s.executionQuality * 0.10 +
    (100 - s.structuralFragility) * 0.10 +
    s.smartMoney * 0.10 +
    s.sourceConcordance * 0.05;

  // Penalties
  let adjusted = raw;
  if (s.structuralFragility > 60) adjusted *= 0.8;
  if (s.depegRisk > 40) adjusted *= 0.85;
  if (s.concentrationRisk > 60) adjusted *= 0.9;

  return clamp(Math.round(adjusted), 0, 100);
}

function computeExitScore(s: DerivedScores): number {
  // Risk-heavy composite
  const raw =
    s.structuralFragility * 0.25 +
    s.depegRisk * 0.20 +
    s.delistRisk * 0.20 +
    s.concentrationRisk * 0.15 +
    (100 - s.liquidityQuality) * 0.10 +
    (100 - s.executionQuality) * 0.10;

  return clamp(Math.round(raw), 0, 100);
}

/* ─── Result builder ─── */

function buildResult(
  netuid: number,
  name: string,
  verdict: VerdictV3,
  primaryReason: VerdictReason,
  secondaryReasons: VerdictReason[],
  riskFlags: VerdictReason[],
  blocks: VerdictBlock[],
  scores: DerivedScores,
  concordance: ConcordanceResult,
  violations: ProhibitionViolation[],
): VerdictV3Result {
  return {
    netuid,
    name,
    verdict,
    verdictFr: verdictLabelFr(verdict),
    verdictEn: verdictLabelEn(verdict),
    urgency: deriveUrgency(verdict, scores),
    confidence: clamp(Math.round(concordance.score * 0.6 + scores.dataConfidence * 0.4), 0, 100),
    conviction: deriveConviction(scores, concordance),
    horizon: deriveHorizon(scores),
    primaryReason,
    secondaryReasons: secondaryReasons.slice(0, 2),
    riskFlags: riskFlags.slice(0, 3),
    isBlocked: blocks.length > 0,
    blocks,
    watchlist: generateWatchlist(scores, verdict),
    concordanceGrade: concordance.grade,
    concordanceScore: concordance.score,
    prohibitionViolations: violations,
    engineVersion: ENGINE_VERSION,
    portfolioAction: derivePortfolioAction(verdict, scores),
  };
}

/* ─── Batch ─── */

export function computeAllVerdictsV3(
  factsMap: Map<number, SubnetFacts>,
  scoringMap: Map<number, ScoringResult>,
  concordanceMap: Map<number, ConcordanceResult>,
): Map<number, VerdictV3Result> {
  const result = new Map<number, VerdictV3Result>();
  for (const [netuid, facts] of factsMap) {
    const scoring = scoringMap.get(netuid);
    const concordance = concordanceMap.get(netuid);
    if (scoring && concordance) {
      result.set(netuid, computeVerdictV3(facts, scoring, concordance));
    }
  }
  return result;
}
