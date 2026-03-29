/* ═══════════════════════════════════════════════════════ */
/*   DECISION FUSION — 3-Layer Architecture                */
/*   Separates and then merges:                            */
/*   1. Canonical Bittensor (official dereg risk)          */
/*   2. TaoFlute External (screening signal)               */
/*   3. TaoStats Market (liquidity, flow, structure)       */
/*   4. Social / X-Twitter (narrative, sentiment)          */
/*                                                         */
/*   Output: single authoritative LayeredDecision          */
/* ═══════════════════════════════════════════════════════ */

import type { OfficialDeregRisk, DeregBand } from "./canonical-dereg";
import type { TaoFluteResolvedStatus, TaoFluteSeverity } from "./taoflute-resolver";
import type { FinalAction } from "./subnet-decision";

/* ══════════════════════════════ */
/*   Layer Types                  */
/* ══════════════════════════════ */

/** Layer 1: Canonical Bittensor structural risk */
export type CanonicalLayer = {
  source: "bittensor_canonical";
  dereg_risk: OfficialDeregRisk;
  verdict: "SAFE" | "LOW_RISK" | "AT_RISK" | "HIGH_RISK" | "CRITICAL";
  updated_at: string | null;
};

/** Layer 2: TaoFlute external screening */
export type TaoFluteLayer = {
  source: "taoflute_external";
  taoflute_match: boolean;
  taoflute_severity: TaoFluteSeverity;
  taoflute_priority: string | null;  // "P1".."P10" or null
  taoflute_delist_flag: boolean;
  taoflute_override_flag: boolean;
  taoflute_source_url: string | null;
  taoflute_reason: string[];
  updated_at: string | null;
};

/** Layer 3: TaoStats market data assessment */
export type TaoStatsLayer = {
  source: "taostats_market";
  liquidity_score: number;      // 0-100
  flow_score: number;           // 0-100 (net flow health)
  structure_score: number;      // 0-100 (miners, validators)
  momentum_score: number;       // 0-100
  execution_score: number;      // 0-100 (slippage, spread)
  verdict: "STRONG" | "HEALTHY" | "NEUTRAL" | "WEAK" | "CRITICAL";
  updated_at: string | null;
};

/** Layer 4: Social / X-Twitter signal */
export type SocialLayer = {
  source: "social_x";
  mentions_24h: number;
  unique_accounts: number;
  kol_score: number;            // 0-100
  heat_score: number;           // 0-100
  conviction_score: number;     // 0-100
  pump_risk_score: number;      // 0-100
  narrative_strength: number;   // 0-100
  social_verdict: SocialVerdict;
  last_post_at: string | null;
  source_urls: string[];
  updated_at: string | null;
};

export type SocialVerdict =
  | "NONE"
  | "NEUTRAL"
  | "WATCH"
  | "CAUTION"
  | "EARLY_PUMP"
  | "BULLISH"
  | "PUMP_RISK";

/** Dominant layer in the final decision */
export type DominantLayer = "CANONICAL" | "TAOFLUTE" | "TAOSTATS" | "SOCIAL" | "MIXED";

/* ══════════════════════════════ */
/*   Layered Decision Output      */
/* ══════════════════════════════ */

export type LayeredDecision = {
  subnet_id: number;

  /* ── Individual layers ── */
  canonical: CanonicalLayer;
  taoflute: TaoFluteLayer;
  taostats: TaoStatsLayer;
  social: SocialLayer;

  /* ── Fusion result ── */
  final_action: FinalAction;
  final_confidence: number;         // 0-100
  dominant_layer: DominantLayer;
  final_reason_primary: string;
  final_reason_secondary: string[];
  final_blockers: string[];
  final_supports: string[];

  /* ── Divergence tracking ── */
  layers_agree: boolean;
  divergence_notes: string[];

  /* ── Audit ── */
  decision_trace: {
    canonical_verdict: string;
    taoflute_verdict: string;
    taostats_verdict: string;
    social_verdict: string;
    fusion_rules_applied: string[];
    guardrails_triggered: string[];
  };
};

/* ══════════════════════════════ */
/*   Layer Builders                */
/* ══════════════════════════════ */

export function buildCanonicalLayer(dereg: OfficialDeregRisk, updatedAt: string | null): CanonicalLayer {
  return {
    source: "bittensor_canonical",
    dereg_risk: dereg,
    verdict: deregBandToVerdict(dereg.official_dereg_band),
    updated_at: updatedAt,
  };
}

function deregBandToVerdict(band: DeregBand): CanonicalLayer["verdict"] {
  switch (band) {
    case "CRITICAL": return "CRITICAL";
    case "HIGH": return "HIGH_RISK";
    case "MEDIUM": return "AT_RISK";
    case "LOW": return "LOW_RISK";
    case "NONE": return "SAFE";
  }
}

export function buildTaoFluteLayer(
  tf: TaoFluteResolvedStatus,
  updatedAt: string | null,
): TaoFluteLayer {
  const reasons: string[] = [];
  if (tf.taoflute_severity === "priority") {
    reasons.push(`Priorité externe P${tf.taoflute_priority_rank ?? "?"}`);
  } else if (tf.taoflute_severity === "watch") {
    reasons.push("Sous surveillance externe");
  }

  return {
    source: "taoflute_external",
    taoflute_match: tf.taoflute_match,
    taoflute_severity: tf.taoflute_severity,
    taoflute_priority: tf.taoflute_priority_rank != null ? `P${tf.taoflute_priority_rank}` : null,
    taoflute_delist_flag: tf.taoflute_severity === "priority",
    taoflute_override_flag: tf.taoflute_severity === "priority",
    taoflute_source_url: tf.externalRisk?.source_ref
      ? `https://taoflute.com/subnet/${tf.subnet_id}`
      : null,
    taoflute_reason: reasons,
    updated_at: updatedAt ?? tf.externalRisk?.source_snapshot_at ?? null,
  };
}

export type TaoStatsLayerInput = {
  liquidityHealth: number;
  flowScore: number;
  structureScore: number;
  momentumScore: number;
  executionScore: number;
  timestamp: string | null;
};

export function buildTaoStatsLayer(input: TaoStatsLayerInput): TaoStatsLayer {
  const avg = Math.round(
    (input.liquidityHealth + input.flowScore + input.structureScore + input.momentumScore + input.executionScore) / 5
  );
  let verdict: TaoStatsLayer["verdict"];
  if (avg >= 70) verdict = "STRONG";
  else if (avg >= 55) verdict = "HEALTHY";
  else if (avg >= 40) verdict = "NEUTRAL";
  else if (avg >= 25) verdict = "WEAK";
  else verdict = "CRITICAL";

  return {
    source: "taostats_market",
    liquidity_score: input.liquidityHealth,
    flow_score: input.flowScore,
    structure_score: input.structureScore,
    momentum_score: input.momentumScore,
    execution_score: input.executionScore,
    verdict,
    updated_at: input.timestamp,
  };
}

export type SocialLayerInput = {
  mentions_24h: number;
  unique_accounts: number;
  kol_score: number;
  heat_score: number;
  conviction_score: number;
  pump_risk_score: number;
  narrative_strength: number;
  final_signal: string;
  last_post_at: string | null;
  source_urls: string[];
  timestamp: string | null;
};

export function buildSocialLayer(input: SocialLayerInput | null): SocialLayer {
  if (!input || input.mentions_24h === 0) {
    return {
      source: "social_x",
      mentions_24h: 0,
      unique_accounts: 0,
      kol_score: 0,
      heat_score: 0,
      conviction_score: 0,
      pump_risk_score: 0,
      narrative_strength: 0,
      social_verdict: "NONE",
      last_post_at: null,
      source_urls: [],
      updated_at: null,
    };
  }

  return {
    source: "social_x",
    mentions_24h: input.mentions_24h,
    unique_accounts: input.unique_accounts,
    kol_score: input.kol_score,
    heat_score: input.heat_score,
    conviction_score: input.conviction_score,
    pump_risk_score: input.pump_risk_score,
    narrative_strength: input.narrative_strength,
    social_verdict: mapSocialSignal(input.final_signal),
    last_post_at: input.last_post_at,
    source_urls: input.source_urls,
    updated_at: input.timestamp,
  };
}

function mapSocialSignal(signal: string): SocialVerdict {
  const s = signal.toUpperCase();
  if (s === "BULLISH") return "BULLISH";
  if (s === "POSITIVE") return "BULLISH";
  if (s === "PUMP_RISK") return "PUMP_RISK";
  if (s === "EARLY_PUMP") return "EARLY_PUMP";
  if (s === "CAUTION") return "CAUTION";
  if (s === "BEARISH") return "WATCH";
  return "NEUTRAL";
}

/* ══════════════════════════════ */
/*   FUSION ENGINE                 */
/* ══════════════════════════════ */

/**
 * Fuse 4 layers into a single authoritative decision.
 *
 * Priority rules:
 * 1. Canonical CRITICAL + not immune → SORTIR/ÉVITER (structural truth)
 * 2. TaoFlute priority → ÉVITER (external guardrail)
 * 3. TaoFlute watch → cap to SURVEILLER
 * 4. TaoStats market data drives ENTRER/SURVEILLER/SORTIR
 * 5. Social enriches but never overrides structural blocks
 *
 * Divergence handling:
 * - If canonical says SAFE but TaoFlute says priority → "Alerte externe non confirmée on-chain"
 * - If canonical says CRITICAL but TaoFlute says none → canonical dominates
 * - If social bullish but canonical critical → "Support spéculatif, risque structurel présent"
 */
export function fuseDecision(
  subnetId: number,
  canonical: CanonicalLayer,
  taoflute: TaoFluteLayer,
  taostats: TaoStatsLayer,
  social: SocialLayer,
  currentFinalAction: FinalAction,
  fr: boolean = true,
): LayeredDecision {
  const rulesApplied: string[] = [];
  const guardrails: string[] = [];
  const blockers: string[] = [];
  const supports: string[] = [];
  const divergenceNotes: string[] = [];

  // ── Track divergences ──
  const canonicalDangerous = canonical.verdict === "CRITICAL" || canonical.verdict === "HIGH_RISK";
  const taofluteActive = taoflute.taoflute_match && taoflute.taoflute_severity !== "none";
  const taostatsWeak = taostats.verdict === "CRITICAL" || taostats.verdict === "WEAK";
  const socialBullish = social.social_verdict === "BULLISH" || social.social_verdict === "EARLY_PUMP";

  // Divergence: canonical safe but taoflute flags risk
  if (!canonicalDangerous && taoflute.taoflute_severity === "priority") {
    divergenceNotes.push(
      fr ? "Alerte externe TaoFlute non confirmée par la logique on-chain canonique"
         : "TaoFlute external alert not confirmed by canonical on-chain logic"
    );
    rulesApplied.push("DIVERGENCE_TAOFLUTE_UNCONFIRMED");
  }

  // Divergence: canonical dangerous but taoflute doesn't flag
  if (canonicalDangerous && !taofluteActive) {
    divergenceNotes.push(
      fr ? "Risque structurel canonique détecté sans signal externe TaoFlute"
         : "Canonical structural risk detected without TaoFlute external signal"
    );
    rulesApplied.push("DIVERGENCE_CANONICAL_ONLY");
  }

  // Convergence: both canonical and taoflute flag risk
  if (canonicalDangerous && taoflute.taoflute_severity === "priority") {
    supports.push(
      fr ? "Risque structurel confirmé par source externe"
         : "Structural risk confirmed by external source"
    );
    rulesApplied.push("CONVERGENCE_CANONICAL_TAOFLUTE");
  }

  // Social vs structure conflict
  if (socialBullish && (canonicalDangerous || taostatsWeak)) {
    divergenceNotes.push(
      fr ? "Signal social bullish en conflit avec risque structurel — support spéculatif uniquement"
         : "Bullish social signal conflicts with structural risk — speculative support only"
    );
    rulesApplied.push("CONFLICT_SOCIAL_VS_STRUCTURE");
  }

  // ── Build blockers & supports ──
  if (canonical.verdict === "CRITICAL") {
    blockers.push(fr ? "Risque de désinscription officiel critique" : "Critical official deregistration risk");
  }
  if (canonical.verdict === "HIGH_RISK") {
    blockers.push(fr ? "Risque de désinscription officiel élevé" : "High official deregistration risk");
  }
  if (taoflute.taoflute_delist_flag) {
    blockers.push(fr ? "Signal externe TaoFlute : delist/priority" : "TaoFlute external signal: delist/priority");
  }
  if (taostats.verdict === "STRONG" || taostats.verdict === "HEALTHY") {
    supports.push(fr ? "Données marché TaoStats favorables" : "TaoStats market data favorable");
  }
  if (socialBullish) {
    supports.push(fr ? "Signal social positif (X/Twitter)" : "Positive social signal (X/Twitter)");
  }
  if (social.social_verdict === "PUMP_RISK") {
    blockers.push(fr ? "Risque de pump détecté (signal social)" : "Pump risk detected (social signal)");
  }

  // ── Determine dominant layer ──
  let dominantLayer: DominantLayer = "TAOSTATS"; // default: market data drives

  if (canonical.verdict === "CRITICAL" && !canonical.dereg_risk.official_immunity_active) {
    dominantLayer = "CANONICAL";
    guardrails.push("CANONICAL_CRITICAL_OVERRIDE");
  } else if (taoflute.taoflute_severity === "priority") {
    dominantLayer = "TAOFLUTE";
    guardrails.push("TAOFLUTE_PRIORITY_BLOCK");
  } else if (canonicalDangerous && taofluteActive) {
    dominantLayer = "MIXED";
  }

  // ── Primary reason based on dominant layer ──
  let primaryReason: string;
  const secondaryReasons: string[] = [];

  switch (dominantLayer) {
    case "CANONICAL":
      primaryReason = fr
        ? `Risque de désinscription officiel ${canonical.dereg_risk.official_dereg_band.toLowerCase()}`
        : `Official deregistration risk ${canonical.dereg_risk.official_dereg_band.toLowerCase()}`;
      if (taoflute.taoflute_match) secondaryReasons.push(...taoflute.taoflute_reason);
      break;
    case "TAOFLUTE":
      primaryReason = fr
        ? `Signal externe TaoFlute : ${taoflute.taoflute_priority ?? "watch"}`
        : `TaoFlute external signal: ${taoflute.taoflute_priority ?? "watch"}`;
      if (canonicalDangerous) {
        secondaryReasons.push(fr ? "Risque structurel officiel également détecté" : "Official structural risk also detected");
      }
      break;
    case "MIXED":
      primaryReason = fr
        ? "Risque structurel officiel + signal externe convergent"
        : "Official structural risk + external signal converge";
      break;
    default:
      primaryReason = fr
        ? `Conditions marché : ${taostats.verdict.toLowerCase()}`
        : `Market conditions: ${taostats.verdict.toLowerCase()}`;
      break;
  }

  // Add social context to secondary reasons
  if (social.social_verdict !== "NONE" && social.social_verdict !== "NEUTRAL") {
    secondaryReasons.push(
      fr ? `Signal social : ${social.social_verdict}` : `Social signal: ${social.social_verdict}`
    );
  }

  // ── Confidence ──
  // Higher confidence when layers agree, lower when divergent
  let confidence = 50; // base
  if (canonical.verdict === "SAFE" && !taofluteActive && (taostats.verdict === "STRONG" || taostats.verdict === "HEALTHY")) confidence = 75;
  if (canonical.verdict === "SAFE" && !taofluteActive && taostats.verdict === "STRONG") confidence = 80;
  if (canonicalDangerous && taofluteActive) confidence = 90; // convergent danger
  if (divergenceNotes.length > 0) confidence = Math.max(30, confidence - 15);
  if (social.social_verdict === "PUMP_RISK") confidence = Math.max(20, confidence - 10);

  const layersAgree = divergenceNotes.length === 0;

  return {
    subnet_id: subnetId,
    canonical,
    taoflute,
    taostats,
    social,

    final_action: currentFinalAction,
    final_confidence: confidence,
    dominant_layer: dominantLayer,
    final_reason_primary: primaryReason,
    final_reason_secondary: secondaryReasons,
    final_blockers: blockers,
    final_supports: supports,

    layers_agree: layersAgree,
    divergence_notes: divergenceNotes,

    decision_trace: {
      canonical_verdict: canonical.verdict,
      taoflute_verdict: taoflute.taoflute_severity,
      taostats_verdict: taostats.verdict,
      social_verdict: social.social_verdict,
      fusion_rules_applied: rulesApplied,
      guardrails_triggered: guardrails,
    },
  };
}
